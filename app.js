require('dotenv').config();
const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('./db'); // MySQL connection pool from db.js
const app = express();

app.use(express.json());

// --- Helper: Haversine Distance (km) ---
function haversineDistance(lat1, lon1, lat2, lon2) {
    const toRad = v => v * Math.PI / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// --- POST /addSchool ---
app.post(
    '/addSchool',
    [
        body('name').isString().notEmpty(),
        body('address').isString().notEmpty(),
        body('latitude').isFloat({ min: -90, max: 90 }),
        body('longitude').isFloat({ min: -180, max: 180 })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        let { name, address, latitude, longitude } = req.body;
        latitude = parseFloat(latitude);
        longitude = parseFloat(longitude);

        try {
            // Check if school already exists (case-insensitive)
            const [existing] = await pool.query(
                'SELECT id FROM schools WHERE LOWER(name) = LOWER(?) AND LOWER(address) = LOWER(?)',
                [name, address]
            );
            if (existing.length > 0) {
                return res.status(400).json({ error: 'School already exists' });
            }

            const [result] = await pool.query(
                'INSERT INTO schools (name, address, latitude, longitude) VALUES (?, ?, ?, ?)',
                [name, address, latitude, longitude]
            );

            res.status(201).json({ message: 'School added successfully', id: result.insertId });
        } catch (error) {
            console.error('MySQL Error:', error);
            res.status(500).json({ error: error.sqlMessage || error.message });
        }
    }
);

// --- GET /listSchools ---
app.get('/listSchools', async (req, res) => {
    try {
        // Accept multiple param names
        const latQ = req.query.lat ?? req.query.latitude;
        const lngQ = req.query.lng ?? req.query.longitude ?? req.query.lon;

        let userLat = Number(latQ);
        let userLng = Number(lngQ);

        // If provided but invalid → treat as null
        if (!isFinite(userLat) || !isFinite(userLng)) {
            userLat = null;
            userLng = null;
        }

        const [rows] = await pool.query('SELECT * FROM schools');

        if (!rows || rows.length === 0) {
            return res.json({ success: true, count: 0, data: [] });
        }

        // If no user coords → use first school's coords
        if (userLat === null || userLng === null) {
            const first = rows[0];
            userLat = Number(first.latitude);
            userLng = Number(first.longitude);

            if (!isFinite(userLat) || !isFinite(userLng)) {
                userLat = 0;
                userLng = 0;
            }
        }

        // Add distance field
        const withDistance = rows.map(school => {
            const sLat = Number(school.latitude);
            const sLng = Number(school.longitude);
            let distance_km = null;
            if (isFinite(sLat) && isFinite(sLng)) {
                distance_km = Number(haversineDistance(userLat, userLng, sLat, sLng).toFixed(4));
            }
            return { ...school, distance_km };
        });

        // Sort: valid distances first
        withDistance.sort((a, b) => {
            if (a.distance_km === null && b.distance_km === null) return 0;
            if (a.distance_km === null) return 1;
            if (b.distance_km === null) return -1;
            return a.distance_km - b.distance_km;
        });

        res.json({
            success: true,
            count: withDistance.length,
            base_coords: { lat: userLat, lng: userLng },
            data: withDistance
        });

    } catch (err) {
        console.error('listSchools error:', err);
        res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
});

// --- Server start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
