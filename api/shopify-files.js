module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!shopifyDomain || !accessToken) {
    return res.status(500).json({ error: 'Shopify credentials not configured' });
  }

  // -------------------------------------------------------
  // LINK WHISPERER — triggered by GET ?action=link-whisperer
  // -------------------------------------------------------
  if (req.method === 'GET' && req.query.action === 'link-whisperer') {
    const endpoint = req.query.endpoint;

    if (!endpoint) {
      return res.status(400).json({ error: 'Missing endpoint parameter' });
    }

    const shopifyUrl = 'https://' + shopifyDomain + '/admin/api/2025-01/' + endpoint;

    try {
      const shopifyResponse = await fetch(shopifyUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
      });

      const responseText = await shopifyResponse.text();

      if (!shopifyResponse.ok) {
        return res.status(shopifyResponse.status).json({
          error: true,
          status: shopifyResponse.status,
          message: responseText,
        });
      }

      // Pass through the Shopify Link header for pagination
      const linkHeader = shopifyResponse.headers.get('Link');
      if (linkHeader) {
        res.setHeader('Link', linkHeader);
      }

      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(responseText);

    } catch (err) {
      return res.status(500).json({ error: true, message: err.message });
    }
  }

  // -------------------------------------------------------
  // EXISTING IMAGE OPTIMIZER ACTIONS — POST only
  // -------------------------------------------------------
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

    if (action === 'update_alt_only') {
      console.log('Updating alt text for: ' + imageUrl);

      function extractFilename(url) {
        return url.split('/').pop().split('?')[0];
      }

      const filename = extractFilename(imageUrl);
      const searchUrl = 'https://' + shopifyDomain + '/admin/api/2025-01/graphql.json';

      const searchQuery = 'query { files(first: 5, query: "filename:' + filename + '") { edges { node { ... on MediaImage { id alt } } } } }';

      const searchResponse = await fetch(searchUrl, {
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
        return res.status(404).json({ error: 'File not found', details: filename });
      }

      const fileId = files[0].node.id;
      console.log('Found file: ' + fileId);

      const safeAlt = (body.altText || '').replace(/"/g, '\\"').replace(/\n/g, ' ');

      const updateMutation = 'mutation { fileUpdate(files: [{ id: "' + fileId + '", alt: "' + safeAlt + '" }]) { files { id alt } userErrors { field message } } }';

      const updateResponse = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query: updateMutation }),
      });

      const updateData = await updateResponse.json();

      if (updateData.data.fileUpdate.userErrors.length > 0) {
        return res.status(500).json({
          error: 'Failed to update alt text',
          details: updateData.data.fileUpdate.userErrors
        });
      }

      console.log('Alt text updated successfully');
      return res.status(200).json({
        success: true,
        message: 'Alt text updated',
        fileId: fileId,
        altText: safeAlt
      });
    }

    if (action === 'replace_file') {
      console.log('Starting file replacement for: ' + imageUrl);
      
      function extractFilename(url) {
        return url.split('/').pop().split('?')[0];
      }
      
      const filename = extractFilename(imageUrl);
      console.log('Extracted filename: ' + filename);
      
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

      console.log('Uploading optimized image...');
      
      const imageBuffer = Buffer.from(optimizedImageBase64, 'base64');
      
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      let formBody = '';
      
      for (const param of stagedTarget.parameters) {
        formBody += '--' + boundary + '\r\n';
        formBody += 'Content-Disposition: form-data; name="' + param.name + '"\r\n\r\n';
        formBody += param.value + '\r\n';
      }
      
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

      console.log('Waiting 3 seconds for file processing...');
      await new Promise(resolve => setTimeout(resolve, 3000));

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
