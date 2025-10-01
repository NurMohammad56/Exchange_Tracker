import httpStatus from "http-status";
import { Product } from "../model/product.model.js";
import { uploadOnCloudinary } from "../utils/commonMethod.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import { User } from "../model/user.model.js";
import { Notification } from "../model/notification.model.js";
import { io } from "../server.js";
import axios from "axios";

const EXCHANGE_API_BASE = "https://api.exchangeratesapi.io/v1";
const API_KEY = process.env.EXCHANGE_RATE_API_KEY;

const getExchangeRate = async (fromCurrency, toCurrency) => {
  if (fromCurrency === toCurrency) return 1;
  try {
    // Latest rates endpoint
    const response = await axios.get(`${EXCHANGE_API_BASE}/latest`, {
      params: {
        access_key: API_KEY,
        base: fromCurrency,
        symbols: toCurrency,
      },
    });
    if (response.data.success) {
      return response.data.rates[toCurrency];
    } else {
      throw new Error("Invalid response");
    }
  } catch (error) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Failed to fetch exchange rate"
    );
  }
};

export const getExchangeRates = catchAsync(async (req, res) => {
  const { base = "USD" } = req.query;
  try {
    const response = await axios.get(`${EXCHANGE_API_BASE}/latest`, {
      params: {
        access_key: API_KEY,
        base,
        symbols: "EUR,GBP,JPY,AUD",
      },
    });
    if (!response.data.success) {
      throw new Error("API error");
    }
    const rates = response.data.rates;
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Exchange rates fetched successfully",
      data: { base, date: new Date(response.data.timestamp * 1000), rates },
    });
  } catch (error) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Failed to fetch rates"
    );
  }
});

const checkPlanLimits = async (userId, action) => {
  const user = await User.findById(userId).populate("subscription", "plan");
  const plan = await SubscriptionPlan.findById(
    user.subscription?.plan ||
      (await SubscriptionPlan.findOne({ name: user.currentPlan }))
  );

  if (action === "addProduct") {
    const currentItems = await Product.countDocuments({ user: userId });
    if (currentItems >= plan.maxItems) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        `Upgrade plan: Max ${plan.maxItems} items for ${plan.name}`
      );
    }
    // For free: Enforce single currency (no foreign if not upgraded)
    if (plan.maxCurrencies === 1 && req.body.foreignCurrency) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "Upgrade for multi-currency comparisons"
      );
    }
  }
  return { showAds: plan.hasAds };
};

// In addProduct (add check before create)
export const addProduct = catchAsync(async (req, res) => {
  await checkPlanLimits(req.user._id, "addProduct");
  const {
    name,
    brand,
    category,
    homePrice,
    homeCountry,
    homeCurrency,
    foreignPrice,
    foreignCountry,
    foreignCurrency,
    note,
    isSaved,
    isPurchase,
    vatRefundPercent,
  } = req.body;
  let image = {};
  if (req.file) {
    image = await uploadOnCloudinary(req.file.path);
  }

  let convertedForeignPrice = foreignPrice;
  if (foreignPrice && homeCurrency !== foreignCurrency) {
    const rate = await getExchangeRate(foreignCurrency, homeCurrency);
    convertedForeignPrice = parseFloat((foreignPrice * rate).toFixed(2));
  }

  const product = await Product.create({
    user: req.user._id,
    name,
    brand,
    category,
    image,
    homePrice,
    homeCountry,
    homeCurrency,
    foreignPrice: convertedForeignPrice,
    foreignCountry,
    foreignCurrency,
    note,
    isSaved: isSaved || false,
    isPurchase: isPurchase || false,
    vatRefundPercent: vatRefundPercent || 20,
  });

  if (isSaved) {
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { savedItems: product._id },
    });
  }
  if (isPurchase) {
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { purchases: product._id },
    });
  }
  const userProducts = await Product.find({ user: req.user._id });
  const totalSavings = userProducts.reduce(
    (sum, p) => sum + p.calculateSavings(),
    0
  );
  const avgSavings = userProducts.length
    ? totalSavings / userProducts.length
    : 0;
  await User.findByIdAndUpdate(req.user._id, { totalSavings, avgSavings });

  const user = await User.findById(req.user._id);
  if (user.enableNotifications && category !== "other") {
    const newNotif = await Notification.create({
      user: req.user._id,
      title: "New Luxury Item Added",
      message: `You've added ${name} from ${brand} to your collection.`,
      type: "general",
      relatedProduct: product._id,
    });
    io.to(req.user._id.toString()).emit("newNotification", newNotif);
  }

  const { showAds } = await checkPlanLimits(req.user._id, "addProduct");
  const productWithCalcs = product.toJSON();
  productWithCalcs.showAds = showAds;

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Product added successfully",
    data: productWithCalcs,
  });
});

// In getProducts (add showAds to each)
export const getProducts = catchAsync(async (req, res) => {
  const { search, category, brand, country, page = 1, limit = 10 } = req.query;
  const filter = { user: req.user._id };
  if (search)
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { brand: { $regex: search, $options: "i" } },
    ];
  if (category) filter.category = category;
  if (brand) filter.brand = brand;
  if (country)
    filter.$or = [{ homeCountry: country }, { foreignCountry: country }];

  products.docs = products.docs.map((p) => p.toJSON());
  const products = await Product.paginate(filter, {
    page: parseInt(page),
    limit: parseInt(limit),
    populate: "user",
  });
  const { showAds } = await checkPlanLimits(req.user._id, "getProducts");
  products.docs = products.docs.map((p) => {
    const json = p.toJSON();
    json.showAds = showAds;
    return json;
  });
  products.showAds = showAds;

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Products fetched successfully",
    data: products,
  });
});

// In getProduct (add flag)
export const getProduct = catchAsync(async (req, res) => {
  const product = await Product.findById(req.params.id).populate("user");
  if (!product || product.user._id.toString() !== req.user._id.toString()) {
    throw new AppError(httpStatus.NOT_FOUND, "Product not found");
  }
  const productWithCalcs = product.toJSON();

  const user = await User.findById(req.user._id);
  if (Math.abs(productWithCalcs.percentDiff) > 5 && user.enableNotifications) {
    const newNotif = await Notification.create({
      user: req.user._id,
      title: "Price Alert",
      message: `Price for ${
        product.name
      } has changed by ${productWithCalcs.percentDiff.toFixed(2)}%`,
      type: "price_increase",
      relatedProduct: product._id,
    });
    io.to(req.user._id.toString()).emit("newNotification", newNotif);
  }

  const { showAds } = await checkPlanLimits(req.user._id, "getProduct");
  productWithCalcs.showAds = showAds;

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Product details fetched successfully",
    data: productWithCalcs,
  });
});

export const updateProduct = catchAsync(async (req, res) => {
  let updateData = req.body;
  let image = {};
  if (req.file) {
    image = await uploadOnCloudinary(req.file.path);
    updateData.image = image;
  }

  let convertedForeignPrice = foreignPrice;
  if (foreignPrice && homeCurrency !== foreignCurrency) {
    const rate = await getExchangeRate(foreignCurrency, homeCurrency);
    convertedForeignPrice = parseFloat((foreignPrice * rate).toFixed(2));
  }

  const product = await Product.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
  }).populate("user");
  if (!product || product.user._id.toString() !== req.user._id.toString()) {
    throw new AppError(httpStatus.NOT_FOUND, "Product not found");
  }

  const userProducts = await Product.find({ user: req.user._id });
  const totalSavings = userProducts.reduce(
    (sum, p) => sum + p.calculateSavings(),
    0
  );
  const avgSavings = userProducts.length
    ? totalSavings / userProducts.length
    : 0;
  await User.findByIdAndUpdate(req.user._id, { totalSavings, avgSavings });

  const productWithCalcs = product.toJSON();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Product updated successfully",
    data: productWithCalcs,
  });
});

export const deleteProduct = catchAsync(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product || product.user._id.toString() !== req.user._id.toString()) {
    throw new AppError(httpStatus.NOT_FOUND, "Product not found");
  }
  await User.findByIdAndUpdate(req.user._id, {
    $pull: { savedItems: req.params.id, purchases: req.params.id },
  });
  const userProducts = await Product.find({ user: req.user._id });
  const totalSavings = userProducts.reduce(
    (sum, p) => sum + p.calculateSavings(),
    0
  );
  const avgSavings = userProducts.length
    ? totalSavings / userProducts.length
    : 0;
  await User.findByIdAndUpdate(req.user._id, { totalSavings, avgSavings });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Product deleted successfully",
  });
});
