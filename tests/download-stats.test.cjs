const {test}=require('node:test');
const assert=require('node:assert/strict');
const {countInstallerDownloads}=require('../scripts/update-download-stats.cjs');
test('counts installer assets and excludes checksum/archive downloads and drafts',()=>{
  assert.equal(countInstallerDownloads([
    {assets:[{id:1,name:'IYK-DeckLab-Windows-Installer.exe',download_count:12},{id:2,name:'SHA256SUMS.txt',download_count:7},{id:3,name:'IYK-DeckLab.nsis.7z',download_count:4},{id:4,name:'IYK-DeckLab.AppImage',download_count:3}]},
    {draft:true,assets:[{name:'IYK-DeckLab.exe',download_count:100}]},
  ]),15);
});
test('ignores duplicate assets and invalid counts',()=>{
  assert.equal(countInstallerDownloads([{assets:[{id:1,name:'IYK-DeckLab.exe',download_count:5},{id:1,name:'IYK-DeckLab.exe',download_count:5},{name:'IYK-DeckLab.exe',download_count:-1}]}]),5);
});
test('empty release history correctly reports zero published downloads',()=>{
  assert.equal(countInstallerDownloads([]),0);
});
