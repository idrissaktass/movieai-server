import express from "express";
import axios from "axios";
import User from "../models/User.js"; // uzantı önemli olabilir (Node ESM’de .js)
    import mongoose from "mongoose";

const router = express.Router();

const ENTITLEMENT_ID = "moodflix-premium";
const RC_SECRET = process.env.REVENUECAT_SECRET;

/////////////////////////////////////////////////////
// 🔹 Premium sync
/////////////////////////////////////////////////////
// Backend: sync.js (Daha güvenli hali)
router.post("/sync", async (req, res) => {
  const { userId, appUserId } = req.body || {};

  if (!userId || !appUserId) {
    return res.status(400).json({ error: "userId and appUserId are required" });
  }

  // RevenueCat'ten entitlement durumunu çek. RC erişilemezse uygulamayı kırma:
  // mevcut DB değerini dönüp 200 ver, böylece frontend hata yemez.
  let premium = null;
  let rcReachable = true;

  try {
    if (!process.env.REVENUECAT_SECRET) {
      throw new Error("REVENUECAT_SECRET is not set");
    }

    const response = await axios.get(
      `https://api.revenuecat.com/v1/subscribers/${appUserId}`,
      { headers: { Authorization: `Bearer ${process.env.REVENUECAT_SECRET}` } }
    );

    const entitlements = response?.data?.subscriber?.entitlements || {};
    premium = entitlements[ENTITLEMENT_ID] || null;
  } catch (err) {
    rcReachable = false;
    console.error("RC Sync Error:", err.response?.data || err.message);
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // RC'ye ulaşabildiysek DB'yi güncelle; ulaşamadıysak mevcut durumu koru.
    if (rcReachable) {
      user.isPremium = !!premium;
      user.premiumExpiresAt = premium?.expires_date || null;
      await user.save();
    }

    return res.json({ isPremium: !!user.isPremium, synced: rcReachable });
  } catch (err) {
    console.error("Premium sync DB error:", err.message);
    return res.status(500).json({ error: "Sync failed" });
  }
});


export default router;
