const mongoose = require('mongoose');

const programSchema = new mongoose.Schema({
    id: { 
        type: String, 
        required: true 
    }, 
    slug: { 
        type: String 
    },
    university_slug: { 
        type: String, 
        required: true 
    },
    name: { 
        type: String, 
        required: true 
    },
    title: { 
        type: String 
    },
    degree: { 
        type: String 
    },
    discipline: { 
        type: String, 
        default: null 
    },
    duration: { 
        type: String 
    },
    study_modes: { 
        type: String 
    },
    delivery_modes: { 
        type: String 
    },
    university_website: { 
        type: String 
    },

    information: {
        type: Object, 
        default: {}
    },

    meta: {
        source: { type: String },
        source_url: { type: String },
        last_crawled_at: { type: Date },
        content_hash: { type: String },
        created_at: { type: Date },
        updated_at: { type: Date }
    }
})

programSchema.index({
  name: "text",
  title: "text",
  degree: "text",
  discipline: "text",
  study_modes: "text",
  delivery_modes: "text",
  university_slug: "text",
});


module.exports = mongoose.model('Program', programSchema)