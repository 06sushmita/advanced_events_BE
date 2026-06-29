const { ObjectId } = require("mongodb");
const { getDB } = require("../config/db");
const eventModel = require("../models/eventModel");
const reportModel = require("../models/reportModel");

function normalizeMessage(message) {
  return (message || "").trim().toLowerCase();
}

function isProviderErrorReply(reply = "") {
  const lower = reply.toLowerCase();
  return (
    lower.includes("openai") ||
    lower.includes("quota") ||
    lower.includes("api key") ||
    lower.includes("service is currently unavailable") ||
    lower.includes("account has exceeded")
  );
}

function getGeneralChatFallback(message) {
  const lowerMsg = normalizeMessage(message);

  if (lowerMsg.includes("email") || lowerMsg.includes("draft")) {
    return "Here’s a follow-up draft: Thanks for joining us. We loved having you at the event. Here are the key links, next steps, and a quick feedback form to help us improve the next one.";
  }

  if (lowerMsg.includes("hello") || lowerMsg.includes("hi")) {
    return "Hi there! I can help with event planning, invites, schedules, attendance, and follow-up messages.";
  }

  if (lowerMsg.includes("features")) {
    return "I can help you look up schedules, check-in locations, registration status, attendance patterns, and event follow-up copy.";
  }

  return "I can help with live event data, invite timing, schedules, registration details, attendance trends, and follow-up copy. Try asking about a specific event or workflow.";
}

async function getSoldOutEventsReply() {
  const events = await getDB().collection("events").find({ status: "active" }).toArray();
  if (events.length === 0) return "There are no active events right now.";

  const soldOut = events.filter((event) => Number(event.capacity || 0) > 0 && Number(event.registrationsCount || 0) >= Number(event.capacity || 0));
  if (soldOut.length === 0) {
    return "No active events are sold out right now.";
  }

  return `Sold-out events right now: ${soldOut
    .slice(0, 5)
    .map((event) => `${event.title} (${event.registrationsCount || 0}/${event.capacity || 0})`)
    .join(", ")}.`;
}

async function getAttendanceTrendReply() {
  const db = getDB();
  const now = new Date();
  const weeks = [];

  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - i * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const [signups, checkins] = await Promise.all([
      db.collection("registrations").countDocuments({
        status: "registered",
        createdAt: { $gte: weekStart, $lt: weekEnd },
      }),
      db.collection("attendance").countDocuments({
        verified: true,
        checkInTime: { $gte: weekStart, $lt: weekEnd },
      }),
    ]);

    weeks.push({ week: `W${8 - i}`, signups, checkins });
  }

  const latest = weeks[weeks.length - 1];
  const previous = weeks[weeks.length - 2] || latest;
  const delta = latest.checkins - previous.checkins;
  const deltaText = delta === 0 ? "flat" : `${delta > 0 ? "+" : ""}${delta} from last week`;

  return `Attendance is now ${latest.checkins} check-in(s) this week versus ${latest.signups} new registration(s). The latest week is ${deltaText}, and the live trend across the last 8 weeks is: ${weeks
    .map((w) => `${w.week} ${w.checkins}`)
    .join(", ")}.`;
}

async function getInviteTimingReply() {
  const db = getDB();
  const events = await db.collection("events").find({ status: "active" }).toArray();
  if (events.length === 0) return "I don't have enough live event data yet to estimate invite timing.";

  const hours = new Map();
  for (const event of events) {
    const createdAt = event.createdAt ? new Date(event.createdAt) : null;
    const registrationsCount = Number(event.registrationsCount || 0);
    if (!createdAt || Number.isNaN(createdAt.getTime()) || registrationsCount <= 0) continue;
    const hour = createdAt.getHours();
    hours.set(hour, (hours.get(hour) || 0) + registrationsCount);
  }

  if (hours.size === 0) {
    return "I can send invites, but I don't have enough live registration history yet to infer a best time.";
  }

  const [bestHour] = [...hours.entries()].sort((a, b) => b[1] - a[1])[0];
  const label = bestHour === 0 ? "12am" : bestHour > 12 ? `${bestHour - 12}pm` : `${bestHour}am`;
  return `Based on live event creation and registration patterns in this workspace, the strongest invite window is around ${label}. I’d still pair that with a reminder 24 hours before start time.`;
}

async function getLiveReply(message, eventId) {
  const lowerMsg = normalizeMessage(message);

  if (lowerMsg.includes("sold") || lowerMsg.includes("sellout") || lowerMsg.includes("sold out")) {
    return getSoldOutEventsReply();
  }

  if (lowerMsg.includes("attendance") || lowerMsg.includes("trend")) {
    return getAttendanceTrendReply();
  }

  if (lowerMsg.includes("invite") || lowerMsg.includes("send")) {
    return getInviteTimingReply();
  }

  if (eventId) {
    const event = await eventModel.getEventById(eventId);
    if (event) {
      if (lowerMsg.includes("when") || lowerMsg.includes("date") || lowerMsg.includes("time")) {
        return `The event "${event.title}" is scheduled for ${String(event.datetime).replace("T", " ")}.`;
      }
      if (lowerMsg.includes("where") || lowerMsg.includes("location") || lowerMsg.includes("address")) {
        return `"${event.title}" will take place at ${event.location}.`;
      }
      if (lowerMsg.includes("capacity") || lowerMsg.includes("limit") || lowerMsg.includes("seats")) {
        return `"${event.title}" has a capacity of ${event.capacity} seats and ${event.registrationsCount || 0} are currently booked.`;
      }
      if (lowerMsg.includes("schedule") || lowerMsg.includes("agenda") || lowerMsg.includes("timeline")) {
        if (event.schedule && event.schedule.length > 0) {
          return `Here is the live schedule for "${event.title}": ${event.schedule.map((s) => `${s.time} - ${s.title}`).join("; ")}.`;
        }
        return `The schedule for "${event.title}" has not been published yet.`;
      }
      if (lowerMsg.includes("register") || lowerMsg.includes("join")) {
        return `You can register for "${event.title}" from the event page.`;
      }
    }
  }

  return null;
}

/**
 * AI chatbot completions
 */
async function chat(req, res, next) {
  try {
    const { message, eventId } = req.body;
    if (!message) return res.status(400).json({ success: false, message: "Message is required." });

    let eventContext = "";
    if (eventId) {
      const event = await eventModel.getEventById(eventId);
      if (event) {
        eventContext = `You are an event assistant for "${event.title}".
Category: ${event.category}
Location: ${event.location}
Date & Time: ${event.datetime}
Description: ${event.description}
Schedule: ${JSON.stringify(event.schedule)}`;
      }
    }

    // Call OpenAI if key is present
    if (process.env.OPENAI_API_KEY) {
      try {
        const { default: OpenAI } = require("openai");
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: eventContext || "You are an AI Event assistant. Help users answer questions about upcoming events." },
            { role: "user", content: message }
          ]
        });
        const reply = completion.choices[0].message.content;
        return res.json({ success: true, reply });
      } catch (err) {
        console.error("OpenAI call failed, falling back to mock:", err.message);
      }
    }

    // Fallback Mock Chatbot
    let reply = (await getLiveReply(message, eventId)) || getGeneralChatFallback(message);
    const lowerMsg = message.toLowerCase();
    
    if (eventId) {
      const event = await eventModel.getEventById(eventId);
      if (event) {
        if (lowerMsg.includes("when") || lowerMsg.includes("date") || lowerMsg.includes("time")) {
          reply = `The event "${event.title}" is scheduled for ${event.datetime.replace("T", " ")}.`;
        } else if (lowerMsg.includes("where") || lowerMsg.includes("location") || lowerMsg.includes("address")) {
          reply = `"${event.title}" will take place at: ${event.location}.`;
        } else if (lowerMsg.includes("schedule") || lowerMsg.includes("agenda") || lowerMsg.includes("timeline")) {
          if (event.schedule && event.schedule.length > 0) {
            reply = `Here is the event schedule:\n` + event.schedule.map(s => `- ${s.time}: ${s.title} (${s.description})`).join("\n");
          } else {
            reply = `The schedule for "${event.title}" hasn't been posted in detail yet, please check back soon!`;
          }
        } else if (lowerMsg.includes("capacity") || lowerMsg.includes("limit") || lowerMsg.includes("seats")) {
          reply = `"${event.title}" has a total capacity of ${event.capacity} seats. Currently ${event.registrationsCount} are booked.`;
        } else if (lowerMsg.includes("register") || lowerMsg.includes("join")) {
          reply = `You can register for "${event.title}" by clicking the 'Register' button on this page. The deadline is ${event.deadline.replace("T", " ")}.`;
        }
      }
    } else {
      if (lowerMsg.includes("hello") || lowerMsg.includes("hi")) {
        reply = "Hi there! How can I help you manage or discover events today?";
      } else if (lowerMsg.includes("features")) {
        reply = "I can help you look up schedules, check-in locations, waitlist states, and certificate downloads.";
      }
    }

    res.json({ success: true, reply });
  } catch (err) {
    next(err);
  }
}

/**
 * AI Description Generator
 */
async function generateDescription(req, res, next) {
  try {
    const { title, category, highlights } = req.body;
    if (!title) return res.status(400).json({ success: false, message: "Event title is required." });

    const prompt = `Write a professional, exciting, and details-rich event description for an event titled "${title}".
Category: ${category || "General"}
Key highlights/bullets: ${highlights || "N/A"}`;

    if (process.env.OPENAI_API_KEY) {
      try {
        const { default: OpenAI } = require("openai");
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are a professional copywriter who specializes in writing compelling descriptions for tech conferences, hackathons, concerts, workshops, and sports matches." },
            { role: "user", content: prompt }
          ]
        });
        const description = completion.choices[0].message.content;
        return res.json({ success: true, description });
      } catch (err) {
        console.error("OpenAI call failed, falling back to mock:", err.message);
      }
    }

    // Mock Description Fallback
    const description = `Join us for an exciting experience at "${title}"! This ${category || "General"} event is custom-built to offer participants an immersive, highly engaging, and knowledge-filled environment. 

Key Highlights:
${highlights || "• Hands-on networking opportunities\n• Collaborative sessions with domain experts\n• Dynamic Q&As and keynote panels"}

Don't miss out on this unique opportunity to connect with peers, expand your skills, and experience high-caliber programming. Register early as capacity is limited!`;

    res.json({ success: true, description });
  } catch (err) {
    next(err);
  }
}

/**
 * AI Recommendations
 */
async function getRecommendations(req, res, next) {
  try {
    const user = await getDB().collection("users").findOne({ _id: new ObjectId(req.user.id) });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const interests = user.interests || [];
    
    // Fetch all active events
    const allEvents = await getDB().collection("events").find({ status: "active" }).toArray();

    if (allEvents.length === 0) {
      return res.json({ success: true, data: [] });
    }

    if (process.env.OPENAI_API_KEY) {
      try {
        const { default: OpenAI } = require("openai");
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const prompt = `Based on the participant's interest tags: ${JSON.stringify(interests)}, recommend and rank the following events: ${JSON.stringify(allEvents.map(e => ({ _id: e._id.toString(), title: e.title, category: e.category, description: e.description })))}. 
Return ONLY a JSON array of event IDs representing the top 4 recommendations, in order of match quality. Output format: ["id1", "id2", "id3", "id4"]`;

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are an AI recommendations engine. You output ONLY valid JSON arrays of string IDs, with no conversational fluff." },
            { role: "user", content: prompt }
          ]
        });

        const rawResult = completion.choices[0].message.content.trim();
        const recommendedIds = JSON.parse(rawResult);
        
        // Map back to full event objects in that order
        const objectIds = recommendedIds.map(id => {
          try { return new ObjectId(id); } catch { return null; }
        }).filter(id => id !== null);

        const recommendedEvents = await getDB().collection("events").find({ _id: { $in: objectIds } }).toArray();
        // Sort according to recommendedIds order
        recommendedEvents.sort((a, b) => {
          return recommendedIds.indexOf(a._id.toString()) - recommendedIds.indexOf(b._id.toString());
        });

        return res.json({ success: true, data: recommendedEvents });
      } catch (err) {
        console.error("OpenAI recommendations failed, falling back to interest tags filter:", err.message);
      }
    }

    // Fallback tag-matching recommendations
    // Rank events by category matching user interests, then return top 4
    const scoredEvents = allEvents.map(event => {
      let score = 0;
      interests.forEach(interest => {
        const lowerInterest = interest.toLowerCase();
        if (event.category.toLowerCase().includes(lowerInterest) || 
            event.title.toLowerCase().includes(lowerInterest) || 
            event.description.toLowerCase().includes(lowerInterest)) {
          score += 2;
        }
      });
      return { event, score };
    });

    scoredEvents.sort((a, b) => b.score - a.score);
    const topRecommended = scoredEvents.slice(0, 4).map(se => se.event);

    res.json({ success: true, data: topRecommended });
  } catch (err) {
    next(err);
  }
}

/**
 * AI Post-Event Summary Reports
 */
async function generateReport(req, res, next) {
  try {
    const { eventId } = req.params;
    const event = await eventModel.getEventById(eventId);
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });

    const db = getDB();
    const [totalRegistered, totalCheckedIn] = await Promise.all([
      db.collection("registrations").countDocuments({ eventId: new ObjectId(eventId), status: "registered" }),
      db.collection("attendance").countDocuments({ eventId: new ObjectId(eventId), verified: true }),
    ]);

    const attendanceRate = totalRegistered > 0 ? Math.round((totalCheckedIn / totalRegistered) * 100) : 0;
    
    // Generate report summary via AI
    const statsContext = {
      title: event.title,
      category: event.category,
      capacity: event.capacity,
      totalRegistered,
      totalCheckedIn,
      attendanceRate: `${attendanceRate}%`
    };

    let summary = "";
    let insights = "";

    if (process.env.OPENAI_API_KEY) {
      try {
        const { default: OpenAI } = require("openai");
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        
        const summaryPrompt = `Generate a professional post-event executive summary report based on the following stats: ${JSON.stringify(statsContext)}. Detail how successful the registrations were and how this reflects team performance.`;
        const insightsPrompt = `Generate 3 actionable insights or participant engagement feedback points based on: ${JSON.stringify(statsContext)}. What could be improved for next time?`;

        const [summaryComp, insightsComp] = await Promise.all([
          openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: summaryPrompt }]
          }),
          openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: insightsPrompt }]
          })
        ]);

        summary = summaryComp.choices[0].message.content;
        insights = insightsComp.choices[0].message.content;
      } catch (err) {
        console.error("OpenAI report writing failed, falling back to mock template:", err.message);
      }
    }

    if (!summary) {
      summary = `The event "${event.title}" under category "${event.category}" completed successfully. It generated significant interest with ${totalRegistered} registered participants, reaching ${Math.round((totalRegistered / event.capacity) * 100)}% of the target capacity (${event.capacity}). With ${totalCheckedIn} verified check-ins, the attendance rate was recorded at ${attendanceRate}%. Overall, the system synced real-time updates seamlessly across platforms.`;
    }

    if (!insights) {
      insights = `1. Capacity Optimization: Registrations reached capacity, indicating high demand. Consider expanding capacity or hosting multiple sessions in future cycles.\n2. Conversion Increase: The attendance rate of ${attendanceRate}% suggests that sending automated email reminders 24 hours prior could improve check-in rates.\n3. Category Growth: "${event.category}" events continue to attract strong participant interest, representing a key focal point for upcoming organizers.`;
    }

    const report = await reportModel.createReport({
      eventId,
      summary,
      attendanceStats: {
        totalRegistered,
        totalCheckedIn,
        rate: attendanceRate
      },
      engagementMetrics: {
        chatQueriesCount: 12, // simulated chatbot counts
        feedbackCount: Math.round(totalCheckedIn * 0.4) // simulated feedback counts
      },
      insights
    });

    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  chat,
  generateDescription,
  getRecommendations,
  generateReport,
};
