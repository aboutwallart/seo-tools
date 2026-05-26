// Authentication check snippet
// Add this script at the TOP of every tool HTML file (right after <body> tag)
// This checks if user is authenticated, redirects to login if not

(function() {
    const TOKEN_KEY = 'seo_tools_auth_token';
    
    function isAuthenticated() {
        try {
            const authData = localStorage.getItem(TOKEN_KEY);
            if (!authData) return false;

            const { token, expiry } = JSON.parse(authData);
            
            // Check if token exists and hasn't expired
            if (token && expiry && Date.now() < expiry) {
                return true;
            }

            // Token expired, remove it
            localStorage.removeItem(TOKEN_KEY);
            return false;
        } catch (error) {
            localStorage.removeItem(TOKEN_KEY);
            return false;
        }
    }

    // Check authentication immediately
    if (!isAuthenticated()) {
        // Redirect to login page
        window.location.href = '/';
    }
})();
