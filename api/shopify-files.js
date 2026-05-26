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
    const altText = body.altText || '';
    const safeAltText = altText.replace(/"/g, '\\"').replace(/\n/g, ' ');

    const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shopifyDomain || !accessToken) {
      return res.status(500).json({ error: 'Shopify credentials not configured' });
    }

    if (action === 'update_alt_smart') {
      console.log('Smart alt text update for: ' + imageUrl);
      
      const pageUrl = body.pageUrl || '';
      const safeAlt = (body.altText || '').replace(/"/g, '\\"').replace(/\n/g, ' ');
      
      function extractFilename(url) {
        return url.split('/').pop().split('?')[0];
      }
      
      // Determine if this is a product image
      const isProductImage = pageUrl.includes('/products/') && imageUrl.includes('/products/');
      
      const graphqlUrl = 'https://' + shopifyDomain + '/admin/api/2025-01/graphql.json';
      
      if (isProductImage) {
        console.log('Product image detected - using productUpdateMedia');
        
        // Extract product handle from page URL
        const handleMatch = pageUrl.match(/\/products\/([^/?]+)/);
        if (!handleMatch) {
          return res.status(400).json({ error: 'Could not extract product handle from URL' });
        }
        
        const productHandle = handleMatch[1];
        console.log('Product handle: ' + productHandle);
        
        // Step 1: Get product ID and media IDs
        const productQuery = `query {
          productByHandle(handle: "${productHandle}") {
            id
            media(first: 50) {
              edges {
                node {
                  ... on MediaImage {
                    id
                    image { url }
                  }
                }
              }
            }
          }
        }`;
        
        const productResponse = await fetch(graphqlUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({ query: productQuery }),
        });
        
        const productData = await productResponse.json();
        
        if (!productData.data || !productData.data.productByHandle) {
          return res.status(404).json({ error: 'Product not found', handle: productHandle });
        }
        
        const productId = productData.data.productByHandle.id;
        const mediaEdges = productData.data.productByHandle.media.edges;
        
        // Step 2: Find matching media by comparing URLs (strip query params)
        const cleanImageUrl = imageUrl.split('?')[0];
        let mediaId = null;
        
        for (const edge of mediaEdges) {
          const mediaUrl = edge.node.image.url.split('?')[0];
          if (mediaUrl === cleanImageUrl) {
            mediaId = edge.node.id;
            break;
          }
        }
        
        if (!mediaId) {
          return res.status(404).json({ error: 'Image not found in product media', url: imageUrl });
        }
        
        console.log('Found media ID: ' + mediaId);
        
        // Step 3: Update using productUpdateMedia
        const updateMutation = `mutation {
          productUpdateMedia(
            productId: "${productId}"
            media: [{
              id: "${mediaId}"
              alt: "${safeAlt}"
            }]
          ) {
            media { alt }
            mediaUserErrors { field message }
          }
        }`;
        
        const updateResponse = await fetch(graphqlUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({ query: updateMutation }),
        });
        
        const updateData = await updateResponse.json();
        
        if (updateData.data.productUpdateMedia.mediaUserErrors.length > 0) {
          return res.status(500).json({
            error: 'Failed to update product media alt text',
            details: updateData.data.productUpdateMedia.mediaUserErrors
          });
        }
        
        console.log('Product media alt text updated successfully');
        return res.status(200).json({
          success: true,
          message: 'Product media alt text updated',
          mediaId: mediaId,
          altText: safeAlt
        });
        
      } else {
        console.log('Content/blog image detected - using delete + recreate');
        
        // For content images: fetch binary, delete, recreate with alt text
        const filename = extractFilename(imageUrl);
        
        // Step 1: Find the file
        const searchQuery = `query { files(first: 5, query: "filename:${filename}") { edges { node { ... on MediaImage { id } } } } }`;
        
        const searchResponse = await fetch(graphqlUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({ query: searchQuery }),
        });
        
        const searchData = await searchResponse.json();
        const files = searchData.data.files.edges;
        
        if (files.length === 0) {
          return res.status(404).json({ error: 'File not found', filename: filename });
        }
        
        const oldFileId = files[0].node.id;
        console.log('Found file to replace: ' + oldFileId);
        
        // Step 2: Fetch original image binary from CDN (strip query params)
        const cleanImageUrl = imageUrl.split('?')[0];
        console.log('Fetching original from: ' + cleanImageUrl);
        
        const imageResponse = await fetch(cleanImageUrl);
        if (!imageResponse.ok) {
          return res.status(500).json({ error: 'Failed to fetch original image from CDN' });
        }
        
        const arrayBuffer = await imageResponse.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');
        const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
        const dataUrl = `data:${mimeType};base64,${base64Data}`;
        
        console.log('Fetched original image, size: ' + arrayBuffer.byteLength + ' bytes');
        
        // Step 3: Create staged upload
        const stagedUploadMutation = `mutation {
          stagedUploadsCreate(input: [{
            resource: IMAGE,
            filename: "${filename}",
            mimeType: "${mimeType}",
            httpMethod: POST
          }]) {
            stagedTargets {
              url
              resourceUrl
              parameters { name value }
            }
          }
        }`;
        
        const stagedResponse = await fetch(graphqlUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({ query: stagedUploadMutation }),
        });
        
        const stagedData = await stagedResponse.json();
        const target = stagedData.data.stagedUploadsCreate.stagedTargets[0];
        
        // Step 4: Upload to staged URL using multipart form
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        let formBody = '';
        
        target.parameters.forEach(param => {
          formBody += `--${boundary}\r\n`;
          formBody += `Content-Disposition: form-data; name="${param.name}"\r\n\r\n`;
          formBody += `${param.value}\r\n`;
        });
        
        formBody += `--${boundary}\r\n`;
        formBody += `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`;
        formBody += `Content-Type: ${mimeType}\r\n\r\n`;
        
        const formBodyBuffer = Buffer.concat([
          Buffer.from(formBody, 'utf8'),
          Buffer.from(arrayBuffer),
          Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
        ]);
        
        const uploadResponse = await fetch(target.url, {
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`
          },
          body: formBodyBuffer
        });
        
        if (!uploadResponse.ok) {
          return res.status(500).json({ error: 'Failed to upload to staged URL' });
        }
        
        console.log('Uploaded to staged URL');
        
        // Step 5: Create new file with alt text
        const createMutation = `mutation {
          fileCreate(files: [{
            originalSource: "${target.resourceUrl}",
            contentType: IMAGE,
            alt: "${safeAlt}"
          }]) {
            files { id alt }
            userErrors { field message }
          }
        }`;
        
        const createResponse = await fetch(graphqlUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({ query: createMutation }),
        });
        
        const createData = await createResponse.json();
        
        if (createData.data.fileCreate.userErrors.length > 0) {
          return res.status(500).json({
            error: 'Failed to create new file',
            details: createData.data.fileCreate.userErrors
          });
        }
        
        const newFileId = createData.data.fileCreate.files[0].id;
        console.log('Created new file: ' + newFileId);
        
        // Step 6: Delete old file after 3 second delay
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const deleteMutation = `mutation { fileDelete(fileIds: ["${oldFileId}"]) { deletedFileIds userErrors { field message } } }`;
        
        const deleteResponse = await fetch(graphqlUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({ query: deleteMutation }),
        });
        
        const deleteData = await deleteResponse.json();
        
        if (deleteData.data.fileDelete.userErrors.length > 0) {
          console.warn('Warning: Could not delete old file:', deleteData.data.fileDelete.userErrors);
          // Don't fail the request - new file was created successfully
        } else {
          console.log('Deleted old file: ' + oldFileId);
        }
        
        return res.status(200).json({
          success: true,
          message: 'File recreated with alt text',
          oldFileId: oldFileId,
          newFileId: newFileId,
          altText: safeAlt
        });
      }
    }

    if (action === 'replace_file') {
      console.log('Starting file replacement for: ' + imageUrl);
      
      // Extract filename from URL
      function extractFilename(url) {
        return url.split('/').pop().split('?')[0];
      }
      
      const filename = extractFilename(imageUrl);
      console.log('Extracted filename: ' + filename);
      
      // Search for file by filename using GraphQL filter
      const searchQuery = 'query { files(first: 5, query: "filename:' + filename + '") { edges { node { ... on MediaImage { id image { url } alt } } } } }';

      const searchUrl = 'https://' + shopifyDomain + '/admin/api/2025-01/graphql.json';
      
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

      const files = searchData.data.files.edges;
      
      console.log('Found ' + files.length + ' matching files');

      if (files.length === 0) {
        console.error('No match found for filename: ' + filename);
        return res.status(404).json({ 
          error: 'File not found in Shopify',
          details: 'Could not find: ' + filename
        });
      }

      const matchingFile = files[0];
      const fileId = matchingFile.node.id;
      console.log('File ID: ' + fileId);

      // Step 2: Create staged upload
      console.log('Creating staged upload...');
      
      const stagedUploadMutation = 'mutation { stagedUploadsCreate(input: { resource: FILE, filename: "' + filename + '", mimeType: "image/webp", httpMethod: POST }) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }';
      
      const stagedResponse = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query: stagedUploadMutation }),
      });

      const stagedData = await stagedResponse.json();
      
      if (stagedData.data.stagedUploadsCreate.userErrors.length > 0) {
        console.error('Staged upload errors: ' + JSON.stringify(stagedData.data.stagedUploadsCreate.userErrors));
        return res.status(500).json({ 
          error: 'Failed to create staged upload',
          details: stagedData.data.stagedUploadsCreate.userErrors
        });
      }

      const stagedTarget = stagedData.data.stagedUploadsCreate.stagedTargets[0];
      console.log('Staged upload URL created');

      // Step 3: Upload file to staged URL
      console.log('Uploading optimized image...');
      
      const imageBuffer = Buffer.from(optimizedImageBase64, 'base64');
      
      // Build form data manually
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      let formBody = '';
      
      // Add parameters
      for (const param of stagedTarget.parameters) {
        formBody += '--' + boundary + '\r\n';
        formBody += 'Content-Disposition: form-data; name="' + param.name + '"\r\n\r\n';
        formBody += param.value + '\r\n';
      }
      
      // Add file
      formBody += '--' + boundary + '\r\n';
      formBody += 'Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n';
      formBody += 'Content-Type: image/webp\r\n\r\n';
      
      const formBodyBuffer = Buffer.concat([
        Buffer.from(formBody, 'utf8'),
        imageBuffer,
        Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8')
      ]);

      const uploadResponse = await fetch(stagedTarget.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
        },
        body: formBodyBuffer,
      });

      if (!uploadResponse.ok) {
        const uploadError = await uploadResponse.text();
        console.error('Upload failed: ' + uploadError);
        return res.status(500).json({ 
          error: 'Failed to upload file',
          details: uploadError
        });
      }

      console.log('Upload successful');

      // Step 4: Create new file with staged resource
      console.log('Creating new file in Shopify...');
      
      const createMutation = 'mutation { fileCreate(files: [{ originalSource: "' + stagedTarget.resourceUrl + '", contentType: IMAGE, alt: "' + safeAltText + '" }]) { files { id } userErrors { field message } } }';
      
      const createResponse = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query: createMutation }),
      });

      const createData = await createResponse.json();
      
      if (createData.data.fileCreate.userErrors.length > 0) {
        console.error('File create errors: ' + JSON.stringify(createData.data.fileCreate.userErrors));
        return res.status(500).json({ 
          error: 'Failed to create new file',
          details: createData.data.fileCreate.userErrors
        });
      }

      const newFileId = createData.data.fileCreate.files[0].id;
      console.log('New file created: ' + newFileId);

      // Wait for Shopify to process the new file
      console.log('Waiting 3 seconds for file processing...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Step 5: Delete old file
      console.log('Deleting old file...');
      
      const deleteMutation = 'mutation { fileDelete(fileIds: ["' + fileId + '"]) { deletedFileIds userErrors { field message } } }';
      
      const deleteResponse = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query: deleteMutation }),
      });

      const deleteData = await deleteResponse.json();
      
      if (deleteData.data.fileDelete.userErrors.length > 0) {
        console.error('File delete errors: ' + JSON.stringify(deleteData.data.fileDelete.userErrors));
        return res.status(500).json({ 
          error: 'Failed to delete old file',
          details: deleteData.data.fileDelete.userErrors
        });
      }

      console.log('Old file deleted. Replacement complete!');

      return res.status(200).json({ 
        success: true,
        message: 'File replaced successfully',
        oldFileId: fileId,
        newFileId: newFileId,
        filename: filename
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
