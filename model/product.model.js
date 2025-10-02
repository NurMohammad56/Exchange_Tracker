import mongoose, { Schema } from "mongoose";
import mongoosePaginate from "mongoose-paginate-v2";

const categoryEnum = [
  "shoes",
  "bags",
  "clothes",
  "jewelry",
  "fragrance",
  "beauty",
  "accessories",
  "other",
];

const countryEnum = [
  "Australia",
  "China",
  "Denmark",
  "France",
  "Finland",
  "Germany",
  "Italy",
  "Ireland",
  "Japan",
  "Spain",
  "Norway",
  "Netherlands",
  "Portugal",
  "Switzerland",
  "UK",
  "USA",
  "Other",
];

const currencyEnum = [
  "Euro",
  "USD",
  "Danish Krone",
  "Norwegian Krone",
  "Yen",
  "Pound",
  "Franc",
  "AUD",
  "Other",
];

const productSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    brand: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: categoryEnum,
      required: true,
    },
    image: {
      public_id: {
        type: String,
        default: "",
      },
      url: {
        type: String,
        default: "",
      },
    },
    homePrice: {
      type: Number,
      required: true,
    },
    homeCountry: {
      type: String,
      enum: countryEnum,
      required: true,
    },
    homeCurrency: {
      type: String,
      enum: currencyEnum,
      required: true,
    },
    foreignPrice: {
      type: Number,
    },
    foreignCountry: {
      type: String,
      enum: countryEnum,
    },
    foreignCurrency: {
      type: String,
      enum: currencyEnum,
    },
    note: {
      type: String,
    },
    isSaved: {
      type: Boolean,
      default: false,
    },
    isPurchase: {
      type: Boolean,
      default: false,
    },
    vatRefundPercent: {
      type: Number,
      default: 20,
    },
  },
  { timestamps: true }
);

productSchema.methods.calculateSavings = function () {
  if (!this.foreignPrice || !this.homePrice) return 0;
  const priceDiff = this.homePrice - this.foreignPrice;
  const vatRefund = (this.foreignPrice * this.vatRefundPercent) / 100;
  return priceDiff + vatRefund;
};

productSchema.methods.calculatePercentDiff = function () {
  if (!this.foreignPrice || !this.homePrice) return 0;
  return ((this.homePrice - this.foreignPrice) / this.homePrice) * 100;
};

productSchema.methods.toJSON = function () {
  const product = this.toObject();
  product.savings = this.calculateSavings();
  product.percentDiff = this.calculatePercentDiff();
  return product;
};

productSchema.plugin(mongoosePaginate);

export const Product = mongoose.model("Product", productSchema);
