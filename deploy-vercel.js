const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = process.env.VERCEL_TOKEN;
const LOG_FILE = path.join(__dirname, 'deploy-log.txt');
const RESULT_FILE = path.join(__dirname, 'deploy-result.json');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  fs.appendFileSync(LOG_FILE, line);
}

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uploadFile(filePath, relName, teamId) {
  const content = fs.readFileSync(filePath);
  const sha = crypto.createHash('sha1').update(content).digest('hex');
  const size = content.length;

  const urlPath = teamId ? `/v2/files?teamId=${teamId}` : '/v2/files';
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.vercel.com',
        path: urlPath,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': size,
          'x-vercel-digest': sha
        }
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          log(`Uploaded ${relName} (size: ${size}, sha: ${sha}, status: ${res.statusCode})`);
          resolve({ file: relName, sha, size });
        });
      }
    );
    req.on('error', reject);
    req.write(content);
    req.end();
  });
}

async function deploy() {
  if (!TOKEN) {
    throw new Error('Set the VERCEL_TOKEN environment variable before deploying.');
  }

  fs.writeFileSync(LOG_FILE, '');
  log('Starting Vercel deployment...');

  // 1. Check user and teams
  const userRes = await request({
    hostname: 'api.vercel.com',
    path: '/v2/user',
    method: 'GET',
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  log(`User: ${JSON.stringify(userRes.body ? userRes.body.user : userRes)}`);

  const teamsRes = await request({
    hostname: 'api.vercel.com',
    path: '/v2/teams',
    method: 'GET',
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  log(`Teams: ${JSON.stringify(teamsRes.body ? teamsRes.body.teams : teamsRes)}`);

  // Choose team: if teams exist, pick the team matching or first
  let teamId = null;
  if (teamsRes.body && teamsRes.body.teams && teamsRes.body.teams.length > 0) {
    const match = teamsRes.body.teams.find(t => 
      t.slug.includes('nazehamosharaf') || t.name.includes('nazehamosharaf')
    ) || teamsRes.body.teams[0];
    teamId = match.id;
    log(`Selected Team: ${match.name} (${match.slug}, id: ${teamId})`);
  }

  // 2. Upload files
  const filesToUpload = [
    { abs: path.join(__dirname, 'index.html'), rel: 'index.html' },
    { abs: path.join(__dirname, 'styles.css'), rel: 'styles.css' },
    { abs: path.join(__dirname, 'config.js'), rel: 'config.js' },
    { abs: path.join(__dirname, 'README.md'), rel: 'README.md' }
  ];

  const uploadedManifest = [];
  for (const f of filesToUpload) {
    if (fs.existsSync(f.abs)) {
      const info = await uploadFile(f.abs, f.rel, teamId);
      uploadedManifest.push(info);
    }
  }

  // 3. Create Deployment
  const projectName = 'romantic-birthday-wish';
  const deployPayload = JSON.stringify({
    name: projectName,
    files: uploadedManifest,
    projectSettings: {
      framework: null
    },
    target: 'production'
  });

  const deployPath = teamId ? `/v13/deployments?teamId=${teamId}` : '/v13/deployments';
  log(`Creating deployment at ${deployPath}...`);

  const deployRes = await request(
    {
      hostname: 'api.vercel.com',
      path: deployPath,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(deployPayload)
      }
    },
    deployPayload
  );

  log(`Deployment response status: ${deployRes.status}`);
  log(`Deployment response: ${JSON.stringify(deployRes.body)}`);

  fs.writeFileSync(RESULT_FILE, JSON.stringify(deployRes.body, null, 2));

  if (deployRes.body && deployRes.body.url) {
    log(`SUCCESS! Live URL: https://${deployRes.body.url}`);
  }
}

deploy().catch((err) => {
  log(`ERROR: ${err.message}\n${err.stack}`);
});
