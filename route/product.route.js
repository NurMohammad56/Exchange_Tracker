import { Router } from "express";
import {
  addProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  getExchangeRates,
  togglePurchase,
} from "../controller/product.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";
const router = Router();

router.post("/add", protect, upload.single("image"), addProduct);
router.get("/", protect, getProducts);
router.get("/exchange-rates", protect, getExchangeRates);
router.get("/:id", protect, getProduct);
router.put("/:id", protect, upload.single("image"), updateProduct);
router.patch("/:id/toggle-purchase", protect, togglePurchase);
router.delete("/:id", protect, deleteProduct);

export default router;
