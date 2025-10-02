import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import router from "./mainroute/index.js";
import { createServer } from "http";
import { Server } from "socket.io";
import axios from "axios";
import globalErrorHandler from "./middleware/globalErrorHandler.js";
import notFound from "./middleware/notFound.js";

const app = express();

app.set("trust proxy", true);

const server = createServer(app);
export const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(
  cors({
    credentials: true,
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/public", express.static("public"));

// Mount the main router
app.use("/api/v1", router);

// Basic route for testing
app.get("/", (req, res) => {
  res.send("Server is running...!!");
});

app.use(globalErrorHandler);
app.use(notFound);

// Socket.io
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join", (userId) => {
    socket.join(userId);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// Real-time Currency Fetching (every 5 min)
const EXCHANGE_API_BASE = "https://api.exchangeratesapi.io/v1";
const API_KEY = process.env.EXCHANGE_RATE_API_KEY;

const fetchAndBroadcastRates = async () => {
  try {
    const response = await axios.get(`${EXCHANGE_API_BASE}/latest`, {
      params: {
        access_key: API_KEY,
        base: "USD",
        symbols: "EUR,GBP,JPY,AUD,DKK,NOK",
      },
    });
    if (response.data.success) {
      const rates = response.data.rates;
      io.emit("currencyUpdate", {
        base: "USD",
        date: new Date(response.data.timestamp * 1000),
        rates,
      });
    }
  } catch (error) {
    console.error("Currency fetch error:", error);
  }
};

// Initial fetch and interval
fetchAndBroadcastRates();
setInterval(fetchAndBroadcastRates, 5 * 60 * 1000);

const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);

  try {
    await mongoose.connect(process.env.MONGO_DB_URL);
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
});
