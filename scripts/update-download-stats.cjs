const fs = require('node:fs');
const path = require('node:path');
const statsPath = path.join(__dirname,'../download-stats.json');

function countInstallerDownloads(releases) {
  let total=0;
  const seen=new Set();
  for (const release of releases) {
    if (release.draft) continue;
    for (const asset of release.assets || []) {
      if (!/IYK[-_ ]?DeckLab/i.test(asset.name || '') || !/\.(exe|msi|dmg|pkg|appimage|apk)$/i.test(asset.name || '')) continue;
      if (asset.id != null && seen.has(asset.id)) continue;
      if (asset.id != null) seen.add(asset.id);
      if (Number.isSafeInteger(asset.download_count) && asset.download_count>=0) total+=asset.download_count;
    }
  }
  return total;
}
async function updateStats() {
  const token=process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const headers={Accept:'application/vnd.github+json',...(token?{Authorization:`Bearer ${token}`}:{})};
  const releases=[];
  for (let page=1;;page++) {
    const response=await fetch(`https://api.github.com/repos/intwanakasi-rgb/IYKV-DJ-/releases?per_page=100&page=${page}`,{headers,signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw Error(`GitHub statistics request returned HTTP ${response.status}`);
    const batch=await response.json();
    if (!Array.isArray(batch)) throw Error('Invalid GitHub release response');
    releases.push(...batch);
    if (batch.length<100) break;
  }
  const stats={total:countInstallerDownloads(releases),updatedAt:new Date().toISOString(),scope:'Published installer downloads on GitHub Releases'};
  fs.writeFileSync(statsPath,JSON.stringify(stats,null,2)+'\n');
  console.log(`Published installer downloads: ${stats.total}`);
}
module.exports={countInstallerDownloads};
if (require.main===module) updateStats().catch(error=>{
  console.warn(`${error.message}. Keeping the previous verified download snapshot; no credentials are included in the app.`);
  if (!fs.existsSync(statsPath)) fs.writeFileSync(statsPath,JSON.stringify({total:null,updatedAt:null,scope:'Published installer downloads on GitHub Releases'},null,2)+'\n');
});
