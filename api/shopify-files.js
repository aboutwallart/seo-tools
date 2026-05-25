module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const action = body.action;
    const imageUrl = body.imageUrl;
    const optimizedImageBase64 = body.optimizedImageBase64;

    const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shopifyDomain || !accessToken) {
      return res.status(500).json({ error: 'Shopify credentials not configured' });
    }

    if (action === 'replace_file') {
      console.log('Starting file replacement for: ' + imageUrl);
      
      const searchQuery = 'query { files(first: 250, query: "media_type:IMAGE") { edges { node { ... on MediaImage { id image { url } } } } } }';

      const searchUrl = 'https://' + shopifyDomain + '/admin/api/2024-01/graphql.json';
      
      const searchResponse = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query: searchQuery }),
      });

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        console.error('Search failed: ' + errorText);
        return res.status(500).json({ 
          error: 'Failed to search Shopify files',
          details: errorText
        });
      }

      const searchData = await searchResponse.json();
      
      if (searchData.errors) {
        console.error('GraphQL errors: ' + JSON.stringify(searchData.errors));
        return res.status(500).json({ 
          error: 'Shopify GraphQL error',
          details: searchData.errors
        });
      }

      function getFilename(url) {
        const parts = url.split('/');
        const filenameWithParams = parts[parts.length - 1];
        return filenameWithParams.split('?')[0];
      }

      const files = searchData.data.files.edges;
      const targetFilename = getFilename(imageUrl);
      
      console.log('Found ' + files.length + ' files in Shopify');
      console.log('Looking for: ' + targetFilename);

      let matchingFile = null;
      for (let i = 0; i < files.length; i++) {
        const edge = files[i];
        const fileUrl = edge.node.image.url;
        if (fileUrl) {
          const shopifyFilename = getFilename(fileUrl);
          if (shopifyFilename === targetFilename) {
            matchingFile = edge;
            console.log('Match found!');
            break;
          }
        }
      }

      if (!matchingFile) {
        console.error('No match found for: ' + targetFilename);
        return res.status(404).json({ 
          error: 'File not found in Shopify',
          details: 'Could not find: ' + targetFilename
        });
      }

      const fileId = matchingFile.node.id;
      console.log('File ID: ' + fileId);

      return res.status(200).json({ 
        success: true,
        message: 'File found successfully',
        fileId: fileId,
        filename: targetFilename
      });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (error) {
    console.error('API error: ' + error.message);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
};
