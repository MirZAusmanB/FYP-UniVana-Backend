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
  },
  { timestamps: true }
);

ShortlistSchema.index({ userId: 1, itemType: 1, itemKey: 1 }, { unique: true });

module.exports = mongoose.model("ShortlistItem", ShortlistSchema);
