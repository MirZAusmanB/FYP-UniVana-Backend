const express = require('express');
const router = express.Router()
const country = require('../models/country');

//GET ALL
router.get('/', async (req,res) => {
    try {
        const countries = await country.find()
        const count = await country.countDocuments()
        res.json({
            countries,
            count
        })
    } catch (error) {
        res.status(500).json({message : error.message})
    }
})

//GET BY ID
router.get('/:id', getCountry, (req, res) =>{
    res.json(req.country)
})

//Delete
router.delete('/:id', getCountry , async (req,res) =>{
    try {
        await req.country.deleteOne()
        res.json({message:'Country deleted'})
    } catch (error) {
        res.status(500).json({message: error.message})
    }

})


async function getCountry(req, res, next) {
    let doc 
    try {
        doc = await country.findById(req.params.id)
        if (doc == null) {
            return res.status(404).json({message:'Cannot find country'})
        }
    } catch (error) {
        return res.status(500).json({message:error.message})
    }
    req.country = doc
    next()
}

module.exports = router