const mongoose = require('mongoose');

const countrySchema = new mongoose.Schema({
    _id: {
        type: String, 
        required: true},
    name: {
        type: String,
        required: true
    },
    slug: {
        type: String,
        required: true
    },
    region: {
        type: String,
        default: null
    },
    description: {
        type: String,
        default: null
    },
    meta: {
        source: {
        type: String,
        },
        source_url: {
        type: String,
        default: null
        },
        last_crawled_at: {
        type: Date,
        default: Date.now
        },
        content_hash: {
        type: String,
        default: null
        },
        index_dom_fp: {
        type: String,
        default: null
        },
        created_at: {
        type: Date,
        default: Date.now
        },
        updated_at: {
        type: Date,
        default: Date.now
        }
    }
}, { collection: 'countries' }); 

module.exports = mongoose.model('Country', countrySchema);