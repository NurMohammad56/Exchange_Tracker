import httpStatus from "http-status";
import { User } from "../model/user.model.js";
import { SubscriptionPlan } from "../model/subcriptionPlan.model.js";
import { UserSubscription } from "../model/userSubcription.model.js";
import { Coupon } from "../model/coupon.model.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";

export const adminDashboard = catchAsync(async (req, res) => {
  const totalSubscriptions = await UserSubscription.countDocuments({
    status: "active",
  });
  const totalCoupons = await Coupon.countDocuments({ status: "active" });
  const totalSalesAgg = await UserSubscription.aggregate([
    { $match: { status: "active" } },
    {
      $lookup: {
        from: "subscriptionplans",
        localField: "plan",
        foreignField: "_id",
        as: "plan",
      },
    },
    { $unwind: "$plan" },
    { $group: { _id: null, total: { $sum: "$plan.priceYearly" } } },
  ]);
  const totalSales = totalSalesAgg[0]?.total || 0;

  const { period = "month" } = req.query;
  const match = { status: "active" };
  const groupBy =
    period === "year" ? { $year: "$startDate" } : { $month: "$startDate" };
  const overviewData = await UserSubscription.aggregate([
    { $match: match },
    { $group: { _id: groupBy, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const totalPayments = await PaymentInfo.countDocuments();
  const pendingPayments = await PaymentInfo.countDocuments({
    paymentStatus: "pending",
  });
  const failedPayments = await PaymentInfo.countDocuments({
    paymentStatus: "failed",
  });
  const paymentOverview = await PaymentInfo.aggregate([
    {
      $match: { createdAt: { $gte: new Date(new Date().getFullYear(), 0, 1) } },
    },
    {
      $group: {
        _id: { $month: "$createdAt" },
        count: { $sum: 1 },
        success: {
          $sum: { $cond: [{ $eq: ["$paymentStatus", "complete"] }, 1, 0] },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Admin dashboard fetched successfully",
    data: {
      totalSubscriptions,
      totalCoupons,
      totalSales,
      overviewData,
      totalPayments,
      pendingPayments,
      failedPayments,
      paymentOverview,
    },
  });
});

export const getUsers = catchAsync(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const users = await User.paginate(
    {},
    {
      page: parseInt(page),
      limit: parseInt(limit),
      populate: {
        path: "subscription",
        populate: { path: "plan", select: "priceMonthly priceYearly" },
      },
      select: "name email createdAt currentPlan subscription.status",
    }
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Users fetched successfully",
    data: users,
  });
});

export const getSubscriptionPlansAdmin = catchAsync(async (req, res) => {
  const plans = await SubscriptionPlan.find().select("-__v");
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Plans fetched successfully",
    data: plans,
  });
});

export const addSubscriptionPlan = catchAsync(async (req, res) => {
  if (req.body.priceMonthly === 0) {
    req.body.hasAds = true;
    req.body.maxItems = 5;
    req.body.maxCurrencies = 1;
  }
  const plan = await SubscriptionPlan.create(req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Plan added successfully",
    data: plan,
  });
});

export const updateSubscriptionPlan = catchAsync(async (req, res) => {
  const plan = await SubscriptionPlan.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true }
  );
  if (!plan) throw new AppError(httpStatus.NOT_FOUND, "Plan not found");

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Plan updated successfully",
    data: plan,
  });
});

export const toggleSubscriptionPlan = catchAsync(async (req, res) => {
  const { action } = req.body;
  let plan;
  if (action === "delete") {
    plan = await SubscriptionPlan.findByIdAndDelete(req.params.id);
  } else {
    plan = await SubscriptionPlan.findByIdAndUpdate(
      req.params.id,
      { isActive: action === "active" },
      { new: true }
    );
  }
  if (!plan) throw new AppError(httpStatus.NOT_FOUND, "Plan not found");
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Plan ${action}d successfully`,
    data: plan,
  });
});

export const getCoupons = catchAsync(async (req, res) => {
  const coupons = await Coupon.find();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Coupons fetched successfully",
    data: coupons,
  });
});

export const addCoupon = catchAsync(async (req, res) => {
  const coupon = await Coupon.create(req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Coupon added successfully",
    data: coupon,
  });
});

export const updateCoupon = catchAsync(async (req, res) => {
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
  });
  if (!coupon) throw new AppError(httpStatus.NOT_FOUND, "Coupon not found");
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Coupon updated successfully",
    data: coupon,
  });
});

export const toggleCoupon = catchAsync(async (req, res) => {
  const { action } = req.body;
  let coupon;
  if (action === "delete") {
    coupon = await Coupon.findByIdAndDelete(req.params.id);
  } else {
    coupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      { status: action },
      { new: true }
    );
  }
  if (!coupon) throw new AppError(httpStatus.NOT_FOUND, "Coupon not found");
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Coupon ${action}d successfully`,
    data: coupon,
  });
});
