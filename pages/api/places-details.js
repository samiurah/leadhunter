export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { place_id } = req.query;
  if (!place_id) {
    return res.status(400).json({ error: "place_id parameter is required" });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Google Places API key not configured."
    });
  }

  try {
    const fields = "name,formatted_phone_number,website,formatted_address,rating,user_ratings_total,business_status";
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(place_id)}&fields=${fields}&key=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(502).json({ error: `Google API HTTP error: ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error("places-details error:", err);
    return res.status(500).json({ error: "Google API call failed", detail: err.message });
  }
}
