import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";

dotenv.config();

const app = express();

const priorities = ["low", "medium", "high", "urgent"];
const statuses = ["open", "in_progress", "resolved", "closed"];
const responseTargetsMinutes = {
  urgent: 60,
  high: 240,
  medium: 1440,
  low: 4320
};

const ticketSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    customerEmail: { type: String, required: true, trim: true, lowercase: true },
    priority: { type: String, enum: priorities, required: true },
    status: { type: String, enum: statuses, default: "open" },
    resolvedAt: { type: Date, default: null }
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

const Ticket = mongoose.models.Ticket || mongoose.model("Ticket", ticketSchema);

/* ── Middleware ── */
app.use(express.json());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(",") : true
  })
);

/* ── Helpers ── */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function withDerivedFields(ticket) {
  const plain = ticket.toObject ? ticket.toObject() : ticket;
  const created = new Date(plain.createdAt).getTime();
  const resolved = plain.resolvedAt ? new Date(plain.resolvedAt).getTime() : null;
  const end = resolved || Date.now();
  const ageMinutes = Math.max(0, Math.floor((end - created) / 60000));
  const target = responseTargetsMinutes[plain.priority];

  return {
    ...plain,
    ageMinutes,
    slaBreached: ageMinutes > target
  };
}

function validateTicketInput(body, { partial = false } = {}) {
  const requiredFields = ["subject", "description", "customerEmail", "priority"];

  if (!partial) {
    for (const field of requiredFields) {
      if (!body[field] || typeof body[field] !== "string" || !body[field].trim()) {
        return `${field} is required`;
      }
    }
  }

  if (body.subject !== undefined && (!body.subject || typeof body.subject !== "string")) {
    return "subject must be a non-empty string";
  }

  if (body.description !== undefined && (!body.description || typeof body.description !== "string")) {
    return "description must be a non-empty string";
  }

  if (body.customerEmail !== undefined && !isValidEmail(body.customerEmail)) {
    return "customerEmail must be a valid email address";
  }

  if (body.priority !== undefined && !priorities.includes(body.priority)) {
    return `priority must be one of: ${priorities.join(", ")}`;
  }

  if (body.status !== undefined && !statuses.includes(body.status)) {
    return `status must be one of: ${statuses.join(", ")}`;
  }

  return null;
}

function validateTransition(from, to) {
  if (from === to) return null;

  const fromIndex = statuses.indexOf(from);
  const toIndex = statuses.indexOf(to);
  const distance = toIndex - fromIndex;

  if (distance === 1 || distance === -1) return null;
  if (distance > 1) return `Cannot skip forward from ${from} to ${to}`;
  return `Can only move backward one step from ${from}`;
}

/* ── MongoDB connection caching for serverless ── */
let cached = global._mongooseCache;
if (!cached) {
  cached = global._mongooseCache = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI, {
      bufferCommands: false
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

/* ── Routes ── */
app.get(["/", "/api"], (req, res) => {
  res.json({ ok: true, message: "DeskFlow API is running" });
});

app.get(["/health", "/api/health"], (req, res) => {
  res.json({ ok: true });
});

app.post(["/tickets", "/api/tickets"], async (req, res, next) => {
  try {
    await connectDB();
    const validationError = validateTicketInput(req.body);
    if (validationError) return badRequest(res, validationError);

    if (req.body.status && req.body.status !== "open") {
      return badRequest(res, "New tickets must start with open status");
    }

    const ticket = await Ticket.create({
      subject: req.body.subject.trim(),
      description: req.body.description.trim(),
      customerEmail: req.body.customerEmail.trim().toLowerCase(),
      priority: req.body.priority
    });

    return res.status(201).json(withDerivedFields(ticket));
  } catch (error) {
    return next(error);
  }
});

app.get(["/tickets", "/api/tickets"], async (req, res, next) => {
  try {
    await connectDB();
    const { status, priority, breached } = req.query;
    const query = {};

    if (status) {
      if (!statuses.includes(status)) return badRequest(res, `status must be one of: ${statuses.join(", ")}`);
      query.status = status;
    }

    if (priority) {
      if (!priorities.includes(priority)) return badRequest(res, `priority must be one of: ${priorities.join(", ")}`);
      query.priority = priority;
    }

    const tickets = (await Ticket.find(query).sort({ createdAt: -1 })).map(withDerivedFields);
    const filtered = breached === "true" ? tickets.filter((ticket) => ticket.slaBreached) : tickets;

    return res.json(filtered);
  } catch (error) {
    return next(error);
  }
});

app.get(["/tickets/stats", "/api/tickets/stats"], async (req, res, next) => {
  try {
    await connectDB();
    const tickets = (await Ticket.find()).map(withDerivedFields);
    const perStatus = Object.fromEntries(statuses.map((status) => [status, 0]));
    const perPriority = Object.fromEntries(priorities.map((priority) => [priority, 0]));

    for (const ticket of tickets) {
      perStatus[ticket.status] += 1;
      perPriority[ticket.priority] += 1;
    }

    return res.json({
      perStatus,
      perPriority,
      breachedOpen: tickets.filter((ticket) => ticket.slaBreached && !["resolved", "closed"].includes(ticket.status)).length
    });
  } catch (error) {
    return next(error);
  }
});

app.patch(["/tickets/:id", "/api/tickets/:id"], async (req, res, next) => {
  try {
    await connectDB();
    const validationError = validateTicketInput(req.body, { partial: true });
    if (validationError) return badRequest(res, validationError);

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    if (req.body.status !== undefined) {
      const transitionError = validateTransition(ticket.status, req.body.status);
      if (transitionError) return badRequest(res, transitionError);

      if (req.body.status === "resolved" && ticket.status === "in_progress") {
        ticket.resolvedAt = new Date();
      }

      if (ticket.status === "resolved" && req.body.status !== "resolved") {
        ticket.resolvedAt = null;
      }

      ticket.status = req.body.status;
    }

    for (const field of ["subject", "description", "customerEmail", "priority"]) {
      if (req.body[field] !== undefined) {
        ticket[field] = typeof req.body[field] === "string" ? req.body[field].trim() : req.body[field];
      }
    }

    await ticket.save();
    return res.json(withDerivedFields(ticket));
  } catch (error) {
    return next(error);
  }
});

app.delete(["/tickets/:id", "/api/tickets/:id"], async (req, res, next) => {
  try {
    await connectDB();
    const deleted = await Ticket.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Ticket not found" });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

/* ── BFHL Routes ── */
app.get(["/bfhl", "/api/bfhl"], (req, res) => {
  return res.status(200).json({ operation_code: 1 });
});

app.post(["/bfhl", "/api/bfhl"], (req, res) => {
  try {
    const { data, file_b64 } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ is_success: false, error: "Invalid input: 'data' must be an array" });
    }

    const numbers = data.filter((item) => !isNaN(item) && item !== "" && item !== null);
    const alphabets = data.filter((item) => typeof item === "string" && /^[a-zA-Z]$/.test(item));
    const lowercaseAlphabets = alphabets.filter((ch) => ch >= "a" && ch <= "z");
    const highestLowercase = lowercaseAlphabets.length > 0
      ? [lowercaseAlphabets.sort((a, b) => b.localeCompare(a))[0]]
      : [];

    // File handling
    let fileValid = false;
    let fileMimeType = null;
    let fileSizeKb = null;

    if (file_b64) {
      try {
        const buffer = Buffer.from(file_b64, "base64");
        fileSizeKb = (buffer.length / 1024).toFixed(2);
        fileValid = true;
        fileMimeType = "application/octet-stream"; // default
      } catch {
        fileValid = false;
      }
    }

    return res.status(200).json({
      is_success: true,
      user_id: "vanshjaiswal_28082005",
      email: "vanshjaiswal230764@acropolis.in",
      roll_number: "0827CS231287",
      numbers,
      alphabets,
      highest_lowercase_alphabet: highestLowercase,
      file_valid: fileValid,
      file_mime_type: fileMimeType,
      file_size_kb: fileSizeKb
    });
  } catch (error) {
    return res.status(500).json({ is_success: false, error: "Internal server error" });
  }
});

app.use((error, req, res, next) => {
  if (error.name === "CastError") {
    return badRequest(res, "Invalid ticket id");
  }

  console.error(error);
  return res.status(500).json({ error: "Internal server error" });
});

export default app;
