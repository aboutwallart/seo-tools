// API endpoint for authentication
// Location: /api/auth.js

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            message: 'Method not allowed' 
        });
    }

    try {
        const { username, password } = req.body;

        // Validate input
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username and password are required'
            });
        }

        // Get password from environment variable
        const CORRECT_PASSWORD = process.env.TOOLS_PASSWORD;

        // Check if environment variable is set
        if (!CORRECT_PASSWORD) {
            console.error('TOOLS_PASSWORD environment variable not set');
            return res.status(500).json({
                success: false,
                message: 'Server configuration error'
            });
        }

        // Validate credentials
        // Username can be anything (we only check password)
        // This allows Chrome to save credentials properly
        if (password === CORRECT_PASSWORD) {
            // Generate a simple token (timestamp-based)
            const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');

            return res.status(200).json({
                success: true,
                token: token,
                message: 'Authentication successful'
            });
        } else {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

    } catch (error) {
        console.error('Auth error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
}
