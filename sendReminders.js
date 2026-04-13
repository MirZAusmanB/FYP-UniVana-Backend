/**
 * Reminder Email Sender
 *
 * What it does:
 *   Looks through everyone's shortlists, finds reminder dates that
 *   match today, and emails the user. Marks each reminder as "sent"
 *   so it won't email twice.
 *
 * How to run:
 *   node sendReminders.js
 *
 * To run it every day at 9 AM automatically (Linux/Mac):
 *   crontab -e
 *   0 9 * * * cd /path/to/FYP-UniVana-Backend && node sendReminders.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const Shortlist = require("./models/shortlist");
const User = require("./models/user");

// Email setup (same as auth.js)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  // Build "today" as a range from midnight to just-before-midnight.
  // We only care about the day, not the hour.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Find shortlist entries that have at least one unsent reminder for today.
  const entries = await Shortlist.find({
    reminderDates: {
      $elemMatch: {
        date: { $gte: startOfDay, $lte: endOfDay },
        sent: false,
      },
    },
  });

  if (entries.length === 0) {
    console.log("No reminders to send today.");
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${entries.length} shortlist entries with reminders due today.`);

  let emailsSent = 0;

  for (const entry of entries) {
    const user = await User.findById(entry.userId);
    if (!user || !user.email) {
      console.log(`  Skipping entry ${entry._id}: no user/email found.`);
      continue;
    }

    // Loop through this entry's reminders and handle the ones due today
    for (const reminder of entry.reminderDates) {
      const isToday = reminder.date >= startOfDay && reminder.date <= endOfDay;
      if (!isToday || reminder.sent) continue;

      try {
        await transporter.sendMail({
          from: `"UniVana" <${process.env.EMAIL_USER}>`,
          to: user.email,
          subject: `Reminder: ${entry.Name || "Your shortlisted university"}`,
          text: [
            `Hi ${user.name || "there"},`,
            "",
            `This is your reminder about ${entry.Name || "a university you shortlisted"}.`,
            entry.city ? `Location: ${entry.city}` : "",
            "",
            `You asked UniVana to remind you today. Don't forget to work on your application!`,
            "",
            "Best of luck,",
            "The UniVana Team",
          ].filter(Boolean).join("\n"),
        });

        reminder.sent = true;
        emailsSent++;
        console.log(`  Sent reminder to ${user.email} for ${entry.Name}`);
      } catch (err) {
        console.error(`  Failed to email ${user.email}: ${err.message}`);
      }
    }

    // Save the updated sent flags for this entry
    await entry.save();
  }

  console.log(`\nDone! Sent ${emailsSent} reminder email(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Error:", err.message);
  mongoose.disconnect();
  process.exit(1);
});
