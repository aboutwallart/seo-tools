module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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
  // NEW: GET BLOGS BY MONTH — uses published_at date
  // -------------------------------------------------------
  if (req.query.action === 'get-blogs-by-month') {
    const month = req.query.month; // format: YYYY-MM
    if (!month) return res.status(400).json({ error: 'Missing month parameter (format: YYYY-MM)' });

    try {
      const [year, mon] = month.split('-');
      const startDate = `${year}-${mon}-01T00:00:00Z`;
      const lastDay = new Date(parseInt(year), parseInt(mon), 0).getDate();
      const endDate = `${year}-${mon}-${lastDay}T23:59:59Z`;

      const articles = [];
      let cursor = null;
      let hasMore = true;

      while (hasMore) {
        const cursorPart = cursor ? `, after: "${cursor}"` : '';
        const query = `{
          articles(first: 250${cursorPart}, query: "published_at:>=${startDate} published_at:<=${endDate}") {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                title
                handle
                publishedAt
                blog { handle title }
              }
            }
          }
        }`;

        const response = await fetch(`https://${shopifyDomain}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
          body: JSON.stringify({ query })
        });

        const data = await response.json();
        if (data.errors) throw new Error(data.errors[0].message);

        const edges = data.data.articles.edges;
        edges.forEach(edge => {
          const node = edge.node;
          const blogHandle = node.blog ? node.blog.handle : 'news-articles-home-decor-inspiration';
          articles.push({
            id: node.id,
            title: node.title,
            handle: node.handle,
            publishedAt: node.publishedAt,
            url: `https://www.aboutwallart.com/blogs/${blogHandle}/${node.handle}`,
            blogTitle: node.blog ? node.blog.title : ''
          });
        });

        if (data.data.articles.pageInfo.hasNextPage) {
          cursor = data.data.articles.pageInfo.endCursor;
        } else {
          hasMore = false;
        }
      }

      return res.status(200).json({ success: true, month, articles });

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // -------------------------------------------------------
  // LINK WHISPERER — GET (read) and PUT (write links)
  // -------------------------------------------------------
  if (req.query.action === 'link-whisperer') {
    const endpoint = req.query.endpoint;
    if (!endpoint) return res.status(400).json({ error: 'Missing endpoint parameter' });

    const shopifyUrl = 'https://' + shopifyDomain + '/admin/api/2025-01/' + endpoint;

    try {
      const fetchOptions = {
        method: req.method === 'PUT' ? 'PUT' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
      };

      if (req.method === 'PUT' && req.body) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const shopifyResponse = await fetch(shopifyUrl, fetchOptions);
      const responseText = await shopifyResponse.text();

      if (!shopifyResponse.ok) {
        return res.status(shopifyResponse.status).json({ error: true, status: shopifyResponse.status, message: responseText });
      }

      const linkHeader = shopifyResponse.headers.get('Link');
      if (linkHeader) res.setHeader('Link', linkHeader);

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

      function extractFilename(url) { return url.split('/').pop().split('?')[0]; }
      const filename = extractFilename(imageUrl);
      const searchUrl = 'https://' + shopifyDomain + '/admin/api/2025-01/graphql.json';
      const searchQuery = 'query { files(first: 5, query: "filename:' + filename + '") { edges { node { ... on MediaImage { id alt } } } } }';
      const searchResponse = await fetch(searchUrl, { method:'POST', headers:{'Content-Type':'application/json','X-Shopify-Access-Token':accessToken}, body:JSON.stringify({query:searchQuery}) });
      const searchData = await searchResponse.json();
      const files = searchData.data.files.edges;
      if (files.length === 0) return res.status(404).json({ error: 'File not found', details: filename });
      const fileId = files[0].node.id;
      const safeAlt = (body.altText || '').replace(/"/g, '\\"').replace(/\n/g, ' ');
      const updateMutation = 'mutation { fileUpdate(files: [{ id: "' + fileId + '", alt: "' + safeAlt + '" }]) { files { id alt } userErrors { field message } } }';
      const updateResponse = await fetch(searchUrl, { method:'POST', headers:{'Content-Type':'application/json','X-Shopify-Access-Token':accessToken}, body:JSON.stringify({query:updateMutation}) });
      const updateData = await updateResponse.json();
      if (updateData.data.fileUpdate.userErrors.length > 0) return res.status(500).json({ error:'Failed to update alt text', details:updateData.data.fileUpdate.userErrors });
      return res.status(200).json({ success:true, message:'Alt text updated', fileId, altText:safeAlt });
    }

    if (action === 'replace_file') {
      console.log('Starting file replacement for: ' + imageUrl);
      function extractFilename(url) { return url.split('/').pop().split('?')[0]; }
      const filename = extractFilename(imageUrl);
      const searchQuery = 'query { files(first: 5, query: "filename:' + filename + '") { edges { node { ... on MediaImage { id image { url } alt } } } } }';
      const searchUrl = 'https://' + shopifyDomain + '/admin/api/2025-01/graphql.json';
      const searchResponse = await fetch(searchUrl, { method:'POST', headers:{'Content-Type':'application/json','X-Shopify-Access-Token':accessToken}, body:JSON.stringify({query:searchQuery}) });
      if (!searchResponse.ok) { const e=await searchResponse.text(); return res.status(500).json({error:'Failed to search Shopify files',details:e}); }
      const searchData = await searchResponse.json();
      if (searchData.errors) return res.status(500).json({error:'Shopify GraphQL error',details:searchData.errors});
      const files = searchData.data.files.edges;
      if (files.length === 0) return res.status(404).json({error:'File not found in Shopify',details:'Could not find: '+filename});
      const fileId = files[0].node.id;
      const stagedUploadMutation = 'mutation { stagedUploadsCreate(input: { resource: FILE, filename: "' + filename + '", mimeType: "image/webp", httpMethod: POST }) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }';
      const stagedResponse = await fetch(searchUrl, { method:'POST', headers:{'Content-Type':'application/json','X-Shopify-Access-Token':accessToken}, body:JSON.stringify({query:stagedUploadMutation}) });
      const stagedData = await stagedResponse.json();
      if (stagedData.data.stagedUploadsCreate.userErrors.length > 0) return res.status(500).json({error:'Failed to create staged upload',details:stagedData.data.stagedUploadsCreate.userErrors});
      const stagedTarget = stagedData.data.stagedUploadsCreate.stagedTargets[0];
      const imageBuffer = Buffer.from(optimizedImageBase64, 'base64');
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      let formBody = '';
      for (const param of stagedTarget.parameters) { formBody += '--'+boundary+'\r\nContent-Disposition: form-data; name="'+param.name+'"\r\n\r\n'+param.value+'\r\n'; }
      formBody += '--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+filename+'"\r\nContent-Type: image/webp\r\n\r\n';
      const formBodyBuffer = Buffer.concat([Buffer.from(formBody,'utf8'), imageBuffer, Buffer.from('\r\n--'+boundary+'--\r\n','utf8')]);
      const uploadResponse = await fetch(stagedTarget.url, { method:'POST', headers:{'Content-Type':'multipart/form-data; boundary='+boundary}, body:formBodyBuffer });
      if (!uploadResponse.ok) { const e=await uploadResponse.text(); return res.status(500).json({error:'Failed to upload file',details:e}); }
      const createMutation = 'mutation { fileCreate(files: [{ originalSource: "' + stagedTarget.resourceUrl + '", contentType: IMAGE, alt: "' + safeAltText + '" }]) { files { id } userErrors { field message } } }';
      const createResponse = await fetch(searchUrl, { method:'POST', headers:{'Content-Type':'application/json','X-Shopify-Access-Token':accessToken}, body:JSON.stringify({query:createMutation}) });
      const createData = await createResponse.json();
      if (createData.data.fileCreate.userErrors.length > 0) return res.status(500).json({error:'Failed to create new file',details:createData.data.fileCreate.userErrors});
      const newFileId = createData.data.fileCreate.files[0].id;
      await new Promise(resolve => setTimeout(resolve, 3000));
      const deleteMutation = 'mutation { fileDelete(fileIds: ["' + fileId + '"]) { deletedFileIds userErrors { field message } } }';
      const deleteResponse = await fetch(searchUrl, { method:'POST', headers:{'Content-Type':'application/json','X-Shopify-Access-Token':accessToken}, body:JSON.stringify({query:deleteMutation}) });
      const deleteData = await deleteResponse.json();
      if (deleteData.data.fileDelete.userErrors.length > 0) return res.status(500).json({error:'Failed to delete old file',details:deleteData.data.fileDelete.userErrors});
      return res.status(200).json({success:true, message:'File replaced successfully', oldFileId:fileId, newFileId, filename});
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (error) {
    console.error('API error: ' + error.message);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
