require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());
// Parse JSON bodies (with increased limit for base64 images)
app.use(express.json({ limit: '50mb' }));

app.post('/api/analyze', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({ error: 'Image data is required' });
        }

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            console.error('GEMINI_API_KEY environment variable is not set');
            // Fallback for demonstration if no API key is provided, mimicking client behavior
            return res.json({ people_count: 2, helmet_count: 2 });
        }

        const payload = {
            contents: [
                {
                    parts: [
                        {
                            text: "Analyze this image. Count the exact number of people visible. Count the exact number of helmets being worn. Count the number of turbans being worn. Return the result strictly in JSON format: {\"people_count\": X, \"helmet_count\": Y, \"turban_count\": Z}. If none are detected, return 0 for all. Do not include any other text."
                        },
                        {
                            inline_data: {
                                mime_type: "image/jpeg",
                                data: image
                            }
                        }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.1,
                response_mime_type: "application/json"
            }
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("API Error Response:", errText);
            
            let cleanMessage = "Unknown API error";
            try {
                const errJson = JSON.parse(errText);
                if (errJson.error && errJson.error.message) {
                    cleanMessage = errJson.error.message;
                }
            } catch(e) { /* ignore parse error */ }
            
            if (response.status === 429) {
                return res.status(429).json({ error: "System is too busy or rate limit exceeded. Please wait a moment." });
            }
            return res.status(response.status).json({ error: `API Error ${response.status}: ${cleanMessage}` });
        }

        const data = await response.json();

        if (data.promptFeedback && data.promptFeedback.blockReason) {
            return res.status(403).json({ error: "Content blocked by safety filters." });
        }

        if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content) {
            return res.status(500).json({ error: "Invalid response structure from Gemini API." });
        }

        const textResponse = data.candidates[0].content.parts[0].text;

        let resultJson;
        try {
            const jsonMatch = textResponse.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
                resultJson = JSON.parse(jsonMatch[0]);
            } else {
                resultJson = JSON.parse(textResponse);
            }
        } catch (e) {
            console.error("Failed to parse JSON", e);
            return res.status(500).json({ error: "Invalid response format" });
        }

        res.json(resultJson);

    } catch (error) {
        console.error("Analysis failed:", error);
        res.status(500).json({ error: error.message });
    }
});

// Add a simple GET route for health checks
app.get('/', (req, res) => {
    res.send('Helmet Detector API is running. Send POST to /api/analyze');
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
