import sharp from "sharp";

export async function createSyntheticUiFixture(path) {
  const overlay = Buffer.from(`
    <svg width="960" height="640" xmlns="http://www.w3.org/2000/svg">
      <rect width="960" height="640" fill="#f4f7fb"/>
      <rect x="24" y="24" width="912" height="72" rx="12" fill="#172033"/>
      <text x="52" y="69" font-family="Arial" font-size="28" fill="white">Synthetic Settings</text>
      <rect x="24" y="120" width="210" height="496" rx="12" fill="#dce5f2"/>
      <text x="48" y="168" font-family="Arial" font-size="22" fill="#26364d">General</text>
      <text x="48" y="210" font-family="Arial" font-size="22" fill="#26364d">Appearance</text>
      <rect x="258" y="120" width="678" height="496" rx="12" fill="white"/>
      <text x="294" y="174" font-family="Arial" font-size="30" fill="#172033">Appearance</text>
      <text x="294" y="232" font-family="Arial" font-size="20" fill="#40526d">Theme</text>
      <rect x="294" y="252" width="590" height="54" rx="8" fill="#eef2f8"/>
      <text x="314" y="286" font-family="Arial" font-size="20" fill="#172033">Dark</text>
      <text x="294" y="370" font-family="Arial" font-size="20" fill="#40526d">Preview</text>
      <rect x="294" y="392" width="590" height="126" rx="8" fill="#e9eef6"/>
      <rect x="846" y="548" width="160" height="48" rx="8" fill="#246bfe"/>
      <text x="882" y="579" font-family="Arial" font-size="20" fill="white">Save changes</text>
    </svg>
  `);
  await sharp(overlay).png().toFile(path);
}
