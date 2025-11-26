export const dexdPointProductPrice = {
  fixedPrice: process.env.DEXD_POINTS_FIXED_PRICE || 0.025
};

export const dexdPointProduct = {
  name: "Dexd Points",
  price: Number(dexdPointProductPrice.fixedPrice),
  description: "Compre Dexd Points",
  cost: 320,
  measureHeight: 1,
  measureWidth: 1,
  measureLength: 1,
  weight: 1,
  ncm: "0000.00.00",
  measurementUnitId: 1,
  quantity: -1,
  medias: [
    {
      url: "https://res.cloudinary.com/dec0bwtda/image/upload/v1696333315/products/ccul4luyroww6khnguaa.jpg",
    },
  ],
};