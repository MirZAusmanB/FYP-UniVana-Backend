const mongoose = require("mongoose");

const ShortlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    itemType: {
      type: String,
      required: true,
      enum: ["university", "program"],
      index: true,
    },

    itemKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    Name: {
      type: String,
      trim: true,
      default: "",
    },

    city: {
      type: String,
      trim: true,
      default: "",
    },

    uniName: {
      type: String,
      trim: true,
      default: "",
    },

    // User-chosen reminder dates (max 3). "sent" stops the reminder
    // script from emailing the same date twice.
    reminderDates: [
      {
        date: { type: Date },
        sent: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true }
);

ShortlistSchema.index({ userId: 1, itemType: 1, itemKey: 1 }, { unique: true });

module.exports = mongoose.model("ShortlistItem", ShortlistSchema);
