export default async function handler(req, res) {
  // CORS headers
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
    const { action, imageUrl, optimizedImageBase64 } = req.body;

    const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shopifyDomain || !accessToken) {
      return res.status(500).json({ error: 'Shopify credentials not configured' });
    }

    if (action === 'replace_file') {
      // Step 1: Find the file in Shopify by URL
      const searchResponse = await fetch(
        `https://${shopifyDomain}/admin/api/2024-01/graphql.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({
            query: `
              query {
                files(first: 250, query: "media_type:IMAGE") {
                  edges {
                    node {
                      ... on MediaImage {
                        id
                        image {
                          url
                        }
                      }
                    }
                  }
                }
              }
            `,
          }),
        }
      );

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        return res.status(500).json({ 
          error: 'Failed to search Shopify files',
          details: errorText
        });
      }

      const searchData = await searchResponse.json();
      
      if (searchData.errors) {
        return res.status(500).json({ 
          error: 'Shopify GraphQL error',
          details: searchData.errors
        });
      }

      // Find matching file by filename only (not full URL)
      const files = searchData.data?.files?.edges || [];
      
      // Extract filename from the image URL (handles both custom domain and Shopify CDN)
      const getFilename = (url) => {
        const parts = url.split('/');
        const filenameWithParams = parts[parts.length - 1];
        // Remove query parameters (e.g., ?v=123456)
        return filenameWithParams.split('?')[0];
      };
      
      const targetFilename = getFilename(imageUrl);
      
      const matchingFile = files.find(edge => {
        const fileUrl = edge.node.image?.url;
        if (!fileUrl) return false;
        
        const shopifyFilename = getFilename(fileUrl);
        return shopifyFilename === targetFilename;
      });

      if (!matchingFile) {
        return res.status(404).json({ 
          error: 'File not found in Shopify',
          details: 'Could not find matching file by URL'
        });
      }

      const fileId = matchingFile.node.id;

      // Step 2: Create staged upload for the new file
      const stagedUploadResponse = await fetch(
        `https://${shopifyDomain}/admin/api/2024-01/graphql.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({
            query: `
              mutation {
                stagedUploadsCreate(input: {
                  resource: FILE,
                  filename: "optimized.webp",
                  mimeType: "image/webp",
                  httpMethod: POST
                }) {
                  stagedTargets {
                    url
                    resourceUrl
                    parameters {
                      name
                      value
                    }
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }
            `,
          }),
        }
      );

      const stagedData = await stagedUploadResponse.json();
      
      if (stagedData.data?.stagedUploadsCreate?.userErrors?.length > 0) {
        return res.status(500).json({ 
          error: 'Failed to create staged upload',
          details: stagedData.data.stagedUploadsCreate.userErrors
        });
      }

      const stagedTarget = stagedData.data?.stagedUploadsCreate?.stagedTargets?.[0];
      if (!stagedTarget) {
        return res.status(500).json({ error: 'No staged upload target returned' });
      }

      // Step 3: Upload the file to staged URL
      const imageBuffer = Buffer.from(optimizedImageBase64, 'base64');
      
      const formData = new FormData();
      stagedTarget.parameters.forEach(param => {
        formData.append(param.name, param.value);
      });
      formData.append('file', new Blob([imageBuffer], { type: 'image/webp' }));

      const uploadResponse = await fetch(stagedTarget.url, {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        return res.status(500).json({ 
          error: 'Failed to upload file to staged URL',
          details: await uploadResponse.text()
        });
      }

      // Step 4: Update the file using the staged resource URL
      const updateResponse = await fetch(
        `https://${shopifyDomain}/admin/api/2024-01/graphql.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({
            query: `
              mutation fileUpdate($files: [FileUpdateInput!]!) {
                fileUpdate(files: $files) {
                  files {
                    id
                    alt
                    createdAt
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }
            `,
            variables: {
              files: [
                {
                  id: fileId,
                  originalSource: stagedTarget.resourceUrl
                }
              ]
            }
          }),
        }
      );

      const updateData = await updateResponse.json();
      
      if (updateData.data?.fileUpdate?.userErrors?.length > 0) {
        return res.status(500).json({ 
          error: 'Failed to update file',
          details: updateData.data.fileUpdate.userErrors
        });
      }

      return res.status(200).json({ 
        success: true,
        message: 'File replaced successfully',
        fileId: fileId
      });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (error) {
    console.error('Shopify API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
}
