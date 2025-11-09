const mongoose = require("mongoose");

const universitySchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    slug: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    country_id: { 
      type: String, 
      required: true 
    },
    city: { 
      type: String 
    },
    website: { 
      type: String 
    },
    founded_year: { 
      type: Number 
    },
    students: {
      total: { type: Number },
      international_percent: { type: Number },
    },
    rankings: { type: mongoose.Schema.Types.Mixed }, // Flexible (may contain multiple rank sources)
    tags: [{ type: String }],
    description: { type: String },

    additional_information: [
      {
        title: { type: String },
        content: { type: String },
      },
    ],

    meta: {
      source: { type: String },
      source_url: { type: String },
      last_crawled_at: { type: Date },
      content_hash: { type: String },
      created_at: { type: Date },
      updated_at: { type: Date },
    },
  },
  { collection: "universities" }
);

module.exports = mongoose.model("University", universitySchema);
