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
import { SubscriptionPlan } from "../model/subcriptionPlan.model.js";

const EXCHANGE_API_BASE = "https://api.exchangeratesapi.io/v1";
const API_KEY = process.env.EXCHANGE_RATE_API_KEY;

const getExchangeRate = async (fromCurrency, toCurrency) => {
  if (fromCurrency === toCurrency) return 1;
  try {
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
      console.log("API Response Error:", response.data); 
      throw new Error("Invalid response");
    }
  } catch (error) {
    console.log(
      "Exchange Rate Error Details:",
      error.response?.data || error.message
    ); 
    return 1; 
  }
};

export const getExchangeRates = catchAsync(async (req, res) => {
  const { base = "EUR" } = req.query;
  try {
    const response = await axios.get(`${EXCHANGE_API_BASE}/latest`, {
      params: {
        access_key: API_KEY,
        base,
        symbols: "EUR,GBP,JPY,AUD",
      },
    });
    if (!response.data.success) {
      console.log("Rates API Error:", response.data);
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
    console.log("Fetch Rates Error:", error.response?.data || error.message);
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Failed to fetch rates"
    );
  }
});

const checkPlanLimits = async (userId, action, req) => {
  const user = await User.findById(userId).populate("subscription", "plan");
  const planDoc = await SubscriptionPlan.findOne({ name: user.currentPlan });
  if (!planDoc) {
    throw new AppError(httpStatus.NOT_FOUND, "User plan not found");
  }
  const plan = planDoc;

  if (action === "addProduct") {
    const currentItems = await Product.countDocuments({ user: userId });
    if (currentItems >= plan.maxItems) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        `Upgrade plan: Max ${plan.maxItems} items for ${plan.name}`
      );
    }
    if (plan.maxCurrencies === 1 && req?.body?.foreignCurrency) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "Upgrade for multi-currency comparisons"
      );
    }
  }
  return { showAds: plan.hasAds };
};

export const addProduct = catchAsync(async (req, res) => {
  const {
    name,
    brand,
    category,
    homePrice,
    homeCountry,
    homeCurrency,
    foreignComparisons = [],
    note,
    isSaved,
    isPurchase,
    vatRefundPercent,
  } = req.body;

  await checkPlanLimits(req.user._id, "addProduct", req);

  let image = {
    public_id: "",
    url: "",
  };

  if (req.file) {
    const uploadResult = await uploadOnCloudinary(req.file.buffer);
    image = {
      public_id: uploadResult.public_id || "",
      url: uploadResult.url || "",
    };
  }

  // Normalize foreignComparisons
  let processedComparisons = [];
  if (Array.isArray(foreignComparisons)) {
    for (let comp of foreignComparisons) {
      let convertedPrice = comp.price ? parseFloat(comp.price) : null;

      if (comp.currency && comp.currency !== homeCurrency) {
        const rate = await getExchangeRate(comp.currency, homeCurrency);
        convertedPrice = parseFloat((parseFloat(comp.price) * rate).toFixed(2));
      }

      processedComparisons.push({
        country: comp.country,
        currency: comp.currency,
        price: convertedPrice,
      });
    }
  }

  const product = await Product.create({
    user: req.user._id,
    name,
    brand,
    category,
    image: image,
    homePrice: parseFloat(homePrice),
    homeCountry,
    homeCurrency,
    foreignComparisons: processedComparisons,
    note,
    isSaved: isSaved === "true" || isSaved === true,
    isPurchase: isPurchase === "true" || isPurchase === true,
    vatRefundPercent: vatRefundPercent ? parseFloat(vatRefundPercent) : 20,
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

  // Update total & avg savings
  const userProducts = await Product.find({ user: req.user._id });
  const totalSavings = userProducts.reduce(
    (sum, p) => sum + p.calculateSavings(),
    0
  );
  const avgSavings = userProducts.length
    ? totalSavings / userProducts.length
    : 0;
  await User.findByIdAndUpdate(req.user._id, { totalSavings, avgSavings });

  // Notification
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

  const { showAds } = await checkPlanLimits(req.user._id, "addProduct", req);
  const productWithCalcs = product.toJSON();
  productWithCalcs.showAds = showAds;

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Product added successfully",
    data: productWithCalcs,
  });
});

export const getProducts = catchAsync(async (req, res, next) => {
  const { search, category, country, page = 1, limit = 10 } = req.query;

  const query = {};

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { brand: { $regex: search, $options: "i" } },
    ];
  }

  if (category) {
    query.category = { $regex: `^${category}$`, $options: "i" };
  }

  if (country) {
    query.$or = [
      { homeCountry: { $regex: `^${country}$`, $options: "i" } },
      { foreignPrice: { $ne: null } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [docs, totalDocs] = await Promise.all([
    Product.find(query).skip(skip).limit(Number(limit)),
    Product.countDocuments(query),
  ]);

  return res.status(200).json({
    success: true,
    message: "Products fetched successfully",
    data: {
      docs,
      totalDocs,
      limit: Number(limit),
      totalPages: Math.ceil(totalDocs / Number(limit)),
      page: Number(page),
      pagingCounter: skip + 1,
      hasPrevPage: page > 1,
      hasNextPage: page * limit < totalDocs,
      prevPage: page > 1 ? Number(page) - 1 : null,
      nextPage: page * limit < totalDocs ? Number(page) + 1 : null,
      showAds: true,
    },
  });
});

export const getProduct = catchAsync(async (req, res) => {
  const product = await Product.findById(req.params.id).populate(
    "user",
    "name email phone avatar subscription"
  );
  if (!product || product.user._id.toString() !== req.user._id.toString()) {
    throw new AppError(httpStatus.NOT_FOUND, "Product not found");
  }

  const { showAds } = await checkPlanLimits(req.user._id, "getProduct", req);

  let comparisons = [
    {
      country: product.homeCountry,
      currency: product.homeCurrency,
      originalPrice: product.homePrice,
      isHome: true,
    },
  ];

  if (product.foreignComparisons && product.foreignComparisons.length > 0) {
    comparisons = comparisons.concat(
      product.foreignComparisons.map((comp) => ({
        country: comp.country,
        currency: comp.currency,
        originalPrice: comp.price,
        isHome: false,
      }))
    );
  }

  // Convert all to homeCurrency + calcs (per Figma)
  let detailedComparisons = [];
  for (let comp of comparisons) {
    let convertedPrice = comp.originalPrice;
    if (comp.currency !== product.homeCurrency) {
      const rate = await getExchangeRate(comp.currency, product.homeCurrency);
      convertedPrice = parseFloat((comp.originalPrice * rate).toFixed(2));
    }
    const estTaxRate = comp.country === "USA" ? 0.1 : 0.08;
    const vatRate = comp.country === "USA" ? 0 : 0.2;
    const estTax = convertedPrice * estTaxRate;
    const totalPrice = convertedPrice + estTax;
    const vatRefund = convertedPrice * vatRate;
    const estRealPrice = totalPrice - vatRefund;

    detailedComparisons.push({
      country: comp.country,
      currency: comp.currency,
      originalPrice: comp.originalPrice,
      convertedPrice: parseFloat(convertedPrice.toFixed(2)),
      estTax: parseFloat(estTax.toFixed(2)),
      totalPrice: parseFloat(totalPrice.toFixed(2)),
      vatRefund: parseFloat(vatRefund.toFixed(2)),
      estRealPrice: parseFloat(estRealPrice.toFixed(2)),
      isHome: comp.isHome,
    });
  }

  // Cheapest non-home
  const nonHome = detailedComparisons.filter((c) => !c.isHome);
  const cheapest = nonHome.length
    ? nonHome.reduce((min, c) => (c.estRealPrice < min.estRealPrice ? c : min))
    : null;
  const homeEstReal = detailedComparisons.find((c) => c.isHome).estRealPrice;
  const savings = cheapest
    ? parseFloat((homeEstReal - cheapest.estRealPrice).toFixed(2))
    : 0;
  const savingsPercent = cheapest
    ? parseFloat(((savings / homeEstReal) * 100).toFixed(2))
    : 0;

  const productWithCalcs = product.toJSON();
  productWithCalcs.detailedComparisons = detailedComparisons;
  productWithCalcs.cheapestCountry = cheapest ? cheapest.country : null;
  productWithCalcs.savings = savings;
  productWithCalcs.savingsPercent = savingsPercent;
  productWithCalcs.showAds = showAds;

  if (savingsPercent > 5) {
    const newNotif = await Notification.create({
      user: req.user._id,
      title: "Savings Alert",
      message: `Save ${savingsPercent}% on ${product.name} by buying in ${cheapest.country}!`,
      type: "savings_alert",
      relatedProduct: product._id,
    });
    io.to(req.user._id.toString()).emit("newNotification", newNotif);
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Product details fetched successfully",
    data: productWithCalcs,
  });
});

export const updateProduct = catchAsync(async (req, res) => {
  let updateData = req.body;

  // Handle image upload
  if (req.file) {
    const uploadResult = await uploadOnCloudinary(req.file.buffer);
    updateData.image = {
      public_id: uploadResult.public_id || "",
      url: uploadResult.url || "",
    };
  }

  // Handle foreignComparisons array
  if (
    updateData.foreignComparisons &&
    Array.isArray(updateData.foreignComparisons)
  ) {
    const product = await Product.findById(req.params.id);
    if (!product) {
      throw new AppError(httpStatus.NOT_FOUND, "Product not found");
    }

    let processedComparisons = [];
    for (let comp of updateData.foreignComparisons) {
      let convertedPrice = comp.price ? parseFloat(comp.price) : null;

      if (comp.currency && comp.currency !== product.homeCurrency) {
        const rate = await getExchangeRate(comp.currency, product.homeCurrency);
        convertedPrice = parseFloat((parseFloat(comp.price) * rate).toFixed(2));
      }

      processedComparisons.push({
        country: comp.country,
        currency: comp.currency,
        price: convertedPrice,
      });
    }
    updateData.foreignComparisons = processedComparisons;
  }

  const product = await Product.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
  }).populate("user");

  if (!product || product.user._id.toString() !== req.user._id.toString()) {
    throw new AppError(httpStatus.NOT_FOUND, "Product not found");
  }

  // Recalculate savings
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

export const togglePurchase = catchAsync(async (req, res) => {
  const { action } = req.body;
  let product;
  if (action === "save") {
    product = await Product.findByIdAndUpdate(
      req.params.id,
      { isPurchase: true },
      { new: true }
    );
  }

  if (!product) throw new AppError(httpStatus.NOT_FOUND, "Product not found");
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Product ${action}d successfully`,
    data: product,
  });
});
