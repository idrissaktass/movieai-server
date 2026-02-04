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
  try {
    const { userId, appUserId } = req.body;
    
    const response = await axios.get(
      `https://api.revenuecat.com/v1/subscribers/${appUserId}`,
      {
        headers: { Authorization: `Bearer ${process.env.REVENUECAT_SECRET}` }
      }
    );

    // DEBUG İÇİN: RevenueCat'ten gelen gerçek veriyi gör
    console.log("RC Raw Data:", JSON.stringify(response.data.subscriber.entitlements, null, 2));

    const entitlements = response.data.subscriber.entitlements || {};
    
    // RevenueCat v1 formatında entitlement doğrudan anahtar olarak gelir:
    // entitlements: { "moodflix-premium": { expires_date: "...", ... } }
    const premium = entitlements[ENTITLEMENT_ID] || null;

    // Sadece 'active' olması yetmez, süresinin dolup dolmadığını RC halleder ama 
    // biz nesnenin varlığını kontrol edelim
    const isPremium = !!premium; 

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { isPremium, premiumExpiresAt: premium?.expires_date || null },
      { new: true }
    );

    console.log("Updated User in DB:", updatedUser);
    res.json({ isPremium: updatedUser.isPremium });
  } catch (err) {
    console.error("RC Sync Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Sync failed" });
  }
});


export default router;
