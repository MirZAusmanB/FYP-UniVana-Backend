const mongoose = require("mongoose");

const countryDetailSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, 
    name: { type: String, required: true },
    slug: { type: String, required: true },
    region: String,
    capital: String,
    currency: String,
    population: String,
    famous_cities: { type: [String], default: [] },

    // 👇 Flexible info array
    information: [
      {
        key: { type: String, required: true },
        value: { type: String, required: true }
      }
    ],
  },
  { timestamps: true, collection: 'countrydetail'  }
);

module.exports = mongoose.model("CountryDetail", countryDetailSchema);
