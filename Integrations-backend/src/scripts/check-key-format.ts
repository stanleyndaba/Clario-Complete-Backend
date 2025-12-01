
const keyBase64 = "c6yA2ltJ025/cXt94SsZU+LgLiPETYjuctTiE+QqRtI=";

console.log(`Provided Key: ${keyBase64}`);
console.log(`Length: ${keyBase64.length}`);

if (keyBase64.length >= 64) {
    console.log("✅ Length >= 64. Code would accept this as Hex.");
} else {
    console.log("❌ Length < 64. Code IGNORES this key and uses fallback!");
}

// Convert to Hex to show what it should be
const buffer = Buffer.from(keyBase64, 'base64');
const keyHex = buffer.toString('hex');
console.log(`\nCorrect Hex format (${keyHex.length} chars):`);
console.log(keyHex);
