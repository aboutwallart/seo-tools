const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  try {
    const blogs = [
      { title: "7 Tips to transform Your Home office decor with Calming Wall Art", keyword: "home office decor calming wall", status: "published", date: "2026-01-01", url: null },
      { title: "Zen Decor Ideas: Calm & Serenity in Your Living space", keyword: "zen decor calm serenity living", status: "published", date: "2026-01-01", url: null },
      { title: "5 Calming Wall Art Ideas to create a Relaxing bedroom decor", keyword: "calming wall relaxing bedroom decor", status: "published", date: "2026-01-01", url: null }
    ];

    await put('blogs.json', JSON.stringify(blogs, null, 2), {
      access: 'public',
      contentType: 'application/json',
      token: process.env.BLOGDATA_READ_WRITE_TOKEN
    });

    return res.status(200).json({ success: true, total: blogs.length });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
