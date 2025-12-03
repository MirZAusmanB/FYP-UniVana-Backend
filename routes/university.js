const express = require('express');
const router = express.Router()
const university = require('../models/University')


//GET ALL
router.get('/', async (req, res) =>{
    try {
        const doc = await university.find()
        const count = await university.countDocuments()
        res.status(200).json({
            doc,
            count
        })
    } catch (error) {
        res.status(500).json({message: error.message})
    }
})

//GET BY ID
router.get('/id/:id', async (req, res) =>{
    try {
        const doc  = await university.findById(req.params.id)
        if (doc == null){
            return res.status(404).json({message : 'university not found!!'})
        }
        res.status(200).json({
            doc
        })
    } catch (error) {
        res.status(500).json({message: error.message})
    }
})

//Get uni names
router.get('/country/:country_id', async (req, res) =>{
    try {
        const doc = await university.find({country_id: req.params.country_id}).select('name')
        const count = doc.length
        if (count === 0){
        return res.status(404).json({message: `university of this country ${country_id} not found`})
        }
        res.status(200).json({
            doc,
            count
        })
    } catch (error) {
        res.status(500).json({message: error.message})
    }
})



module.exports = router