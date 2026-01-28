// models/WatchParty.js
import mongoose from "mongoose";

const WatchPartySchema = new mongoose.Schema({
  code: { type: String, unique: true },

  host: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  guest: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

  hostAnswers: Object,
  guestAnswers: Object,

  hostDone: { type: Boolean, default: false },
  guestDone: { type: Boolean, default: false },

  results: { type: Array, default: [] },

  status: {
    type: String,
    enum: ["waiting", "answering", "ready", "done"],
    default: "waiting"
  }

}, { timestamps: true });

export default mongoose.model("WatchParty", WatchPartySchema);
