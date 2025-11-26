import { roles } from "../helpers/roles";

export const types = {
  actionDexdPoints: "ação - dexd points",
  auctionYourBid: "arremate - dê o seu lance",
  auctionWantToBid: "arremate - quero arrematar",
  quoteBulkPurchases: "cotação - compras em lote",
  quoteCustomProductManufacturing: "cotação - fabricação de produtos customizados",
  quoteProducts: "cotação de produtos",
  quoteLargeProjects: "cotação de produtos - grandes obras",
  quoteProjects: "cotação de projetos",
  quoteImport: "cotação importação",
  customProductManufacturing: "fabricação de produtos customizados",
  supplyLargeProjects: "fornecimento de produtos - grandes obras",
  interestCustomProductManufacturing: "interesse em fabricação de produto customizado",
  interestPartnershipSupply: "interesse em parceria - fornecimento",
  stockLiquidation: "liquidação de estoque",
  showroomLiquidation: "liquidação de showroom",
  offerImportGroup: "oferta - importação em grupo",
  exclusiveImportOffer: "oferta - importação exclusiva",
  projectOffer: "oferta de projetos",
  flashOffer: "oferta relâmpago",
  partnershipDistribution: "parceria - distribuição",
  showcasePartnership: "parceria vitrine",
  launchPromotion: "promoção de lançamento",
  wantToBeDistributor: "quero ser o distribuidor do seu produto",
  wantToBeSupplier: "quero ser o seu fornecedor",
  requestProductSample: "solicitar amostra de produto",
  batchSales: "vendas em lote"
};

export const businessOpportunitiesRoles = [
  {
    role: roles.architect,
    opportunitiesTypes: [
      {
        type: types.showcasePartnership,
        allowedRoles: [
          { role: roles.store }
        ]
      },
      {
        type: types.quoteLargeProjects,
        allowedRoles: [
          { role: roles.store },
          { role: roles.supplier },
          { role: roles.manufacturer }
        ]
      },
      {
        type: types.quoteProducts,
        allowedRoles: [
          { role: roles.store },
          { role: roles.supplier },
          { role: roles.manufacturer }
        ]
      },
      {
        type: types.projectOffer,
        allowedRoles: [
          { role: roles.consumer }
        ]
      },
      {
        type: types.requestProductSample,
        allowedRoles: [
          { role: roles.store },
          { role: roles.supplier },
          { role: roles.manufacturer }
        ]
      }
    ]
  },
  {
    role: roles.store,
    opportunitiesTypes: [
      {
        type: types.showcasePartnership,
        allowedRoles: [
          { role: roles.architect }
        ]
      },
      {
        type: types.showroomLiquidation,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect }
        ]
      },
      {
        type: types.stockLiquidation,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect }
        ]
      },
      {
        type: types.launchPromotion,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect }
        ]
      },
      {
        type: types.flashOffer,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect }
        ]
      },
      {
        type: types.quoteImport,
        allowedRoles: [
          { role: roles.supplier }
        ]
      },
      {
        type: types.quoteBulkPurchases,
        allowedRoles: [
          { role: roles.supplier },
          { role: roles.manufacturer }
        ]
      },
      {
        type: types.interestPartnershipSupply,
        allowedRoles: [
          { role: roles.supplier },
          { role: roles.manufacturer }
        ]
      },
      {
        type: types.interestCustomProductManufacturing,
        allowedRoles: [
          { role: roles.manufacturer }
        ]
      },
      {
        type: types.requestProductSample,
        allowedRoles: [
          { role: roles.supplier },
          { role: roles.manufacturer }
        ]
      },
      {
        type: types.auctionWantToBid,
        allowedRoles: [
          { role: roles.supplier },
          { role: roles.manufacturer }
        ]
      },
      {
        type: types.auctionYourBid,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect }
        ]
      },
      {
        type: types.actionDexdPoints,
        allowedRoles: [
          { role: roles.architect }
        ]
      }
    ]
  },
  {
    role: roles.supplier,
    opportunitiesTypes: [
      {
        type: types.stockLiquidation,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect },
          { role: roles.store }
        ]
      },
      {
        type: types.launchPromotion,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect },
          { role: roles.store }
        ]
      },
      {
        type: types.flashOffer,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect },
          { role: roles.store }
        ]
      },
      {
        type: types.exclusiveImportOffer,
        allowedRoles: [
          { role: roles.store },
          { role: roles.supplier }
        ]
      },
      {
        type: types.offerImportGroup,
        allowedRoles: [
          { role: roles.store },
          { role: roles.supplier }
        ]
      },
      {
        type: types.wantToBeSupplier,
        allowedRoles: [
          { role: roles.store },
          { role: roles.supplier }
        ]
      },
      {
        type: types.batchSales,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect },
          { role: roles.store },
          { role: roles.supplier }
        ]
      },
      {
        type: types.wantToBeDistributor,
        allowedRoles: [
          { role: roles.manufacturer },
          { role: roles.supplier }
        ]
      },
      {
        type: types.requestProductSample,
        allowedRoles: [
          { role: roles.manufacturer },
          { role: roles.supplier }
        ]
      },
      {
        type: types.auctionWantToBid,
        allowedRoles: [
          { role: roles.manufacturer },
          { role: roles.supplier }
        ]
      },
      {
        type: types.auctionYourBid,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect },
          { role: roles.store },
          { role: roles.supplier }
        ]
      },
      {
        type: types.actionDexdPoints,
        allowedRoles: [
          { role: roles.architect },
          { role: roles.store },
          { role: roles.supplier }
        ]
      }
    ]
  },
  {
    role: roles.manufacturer,
    opportunitiesTypes: [
      {
        type: types.stockLiquidation,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect },
          { role: roles.store },
          { role: roles.supplier }
        ]
      },
      {
        type: types.launchPromotion,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect },
          { role: roles.store },
          { role: roles.supplier }
        ]
      },
      {
        type: types.flashOffer,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect },
          { role: roles.store },
          { role: roles.supplier }
        ]
      },
      {
        type: types.wantToBeSupplier,
        allowedRoles: [
          { role: roles.store },
          { role: roles.supplier }
        ]
      },
      {
        type: types.batchSales,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect },
          { role: roles.store },
          { role: roles.supplier }
        ]
      },
      {
        type: types.customProductManufacturing,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect },
          { role: roles.store },
          { role: roles.supplier }
        ]
      },
      {
        type: types.partnershipDistribution,
        allowedRoles: [
          { role: roles.supplier }
        ]
      },
      {
        type: types.supplyLargeProjects,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect },
          { role: roles.store }
        ]
      },
      {
        type: types.auctionYourBid,
        allowedRoles: [
          { role: roles.consumer },
          { role: roles.architect },
          { role: roles.store },
          { role: roles.supplier }
        ]
      },
      {
        type: types.actionDexdPoints,
        allowedRoles: [
          { role: roles.architect },
          { role: roles.store },
          { role: roles.supplier }
        ]
      }
    ]
  },
  {
    role: roles.consumer,
    opportunitiesTypes: [
      {
        type: types.quoteLargeProjects,
        allowedRoles: [
          { role: roles.store }
        ]
      },
      {
        type: types.quoteLargeProjects,
        allowedRoles: [
          { role: roles.store },
          { role: roles.supplier },
          { role: roles.manufacturer }
        ]
      },
      {
        type: types.quoteProjects,
        allowedRoles: [
          { role: roles.architect }
        ]
      },
      {
        type: types.quoteBulkPurchases,
        allowedRoles: [
          { role: roles.store },
          { role: roles.supplier },
          { role: roles.manufacturer }
        ]
      },
      {
        type: types.quoteCustomProductManufacturing,
        allowedRoles: [
          { role: roles.manufacturer }
        ]
      },
      {
        type: types.quoteImport,
        allowedRoles: [
          { role: roles.supplier }
        ]
      },
      {
        type: types.requestProductSample,
        allowedRoles: [
          { role: roles.store },
          { role: roles.supplier },
          { role: roles.manufacturer }
        ]
      },
      {
        type: types.auctionWantToBid,
        allowedRoles: [
          { role: roles.store },
          { role: roles.supplier },
          { role: roles.manufacturer }
        ]
      }
    ]
  }
]