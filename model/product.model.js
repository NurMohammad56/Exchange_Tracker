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

const foreignComparisonSchema = new Schema(
  {
    country: {
      type: String,
      enum: countryEnum,
      required: false,
    },
    currency: {
      type: String,
      enum: currencyEnum,
      required: false,
    },
    price: {
      type: Number,
      required: false,
    },
  },
  { _id: false }
);

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
    foreignComparisons: {
      type: [foreignComparisonSchema],
      default: [],
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
  let totalSavings = (this.homePrice * this.vatRefundPercent) / 100; // Always home VAT
  if (this.foreignComparisons && this.foreignComparisons.length > 0) {
    const validComps = this.foreignComparisons.filter(
      (comp) => comp && comp.price && typeof comp.price === "number"
    );
    validComps.forEach((comp) => {
      totalSavings +=
        this.homePrice -
        comp.price +
        (comp.price * this.vatRefundPercent) / 100;
    });
  }
  return totalSavings;
};

productSchema.methods.calculatePercentDiff = function () {
  if (!this.foreignComparisons || this.foreignComparisons.length === 0)
    return 0;
  const validComps = this.foreignComparisons.filter(
    (comp) => comp && comp.price && typeof comp.price === "number"
  );
  if (validComps.length === 0) return 0;
  const avgForeign =
    validComps.reduce((sum, comp) => sum + comp.price, 0) / validComps.length;
  return ((this.homePrice - avgForeign) / this.homePrice) * 100;
};

productSchema.methods.toJSON = function () {
  const product = this.toObject();
  product.savings = this.calculateSavings();
  product.percentDiff = this.calculatePercentDiff();
  product.foreignComparisons = product.foreignComparisons.filter(
    (comp) => comp && comp.country && comp.currency
  );
  return product;
};

productSchema.plugin(mongoosePaginate);

export const Product = mongoose.model("Product", productSchema);
