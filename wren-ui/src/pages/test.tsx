import React from 'react';
import dynamic from 'next/dynamic';
import { TopLevelSpec } from 'vega-lite';

const Chart = dynamic(() => import('@/components/chart'), {
  ssr: false,
});

const spec: TopLevelSpec = {
  $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
  data: {
    values: [
      {
        country: 'Taiwan, Province of China',
        group: 'Eastern',
        opportunity_count: 16,
      },
      { country: null, group: 'Eastern', opportunity_count: 8 },
      { country: 'United States', group: 'Western', opportunity_count: 2 },
      { country: 'France', group: 'Western', opportunity_count: 1 },
      { country: 'Germany', group: 'Western', opportunity_count: 1 },
    ],
  },
  mark: { type: 'bar' },
  encoding: {
    x: { field: 'country', type: 'nominal', axis: { title: 'Country' } },
    y: {
      field: 'opportunity_count',
      type: 'quantitative',
      axis: { title: 'Opportunity Count' },
      stack: 'zero',
    },
    color: { field: 'group', type: 'nominal' },
  },
};

const spec2: TopLevelSpec = {
  $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
  data: {
    values: [
      { industry_percentage: 36.95, company_industry: null },
      { industry_percentage: 15.8, company_industry: 'COMPUTER_SOFTWARE' },
      { industry_percentage: 4.31, company_industry: 'COMPUTER_HARDWARE' },
      { industry_percentage: 4.31, company_industry: 'BANKING' },
      { industry_percentage: 2.87, company_industry: 'CAPITAL_MARKETS' },
      { industry_percentage: 2.22, company_industry: 'FINANCIAL_SERVICES' },
      {
        industry_percentage: 1.96,
        company_industry: 'PROFESSIONAL_TRAINING_COACHING',
      },
      { industry_percentage: 1.83, company_industry: 'TELECOMMUNICATIONS' },
      { industry_percentage: 1.83, company_industry: 'INSURANCE' },
      { industry_percentage: 1.7, company_industry: 'WIRELESS' },
      { industry_percentage: 1.44, company_industry: 'HIGHER_EDUCATION' },
      {
        industry_percentage: 1.44,
        company_industry: 'MECHANICAL_OR_INDUSTRIAL_ENGINEERING',
      },
      { industry_percentage: 1.31, company_industry: 'PUBLISHING' },
      {
        industry_percentage: 1.31,
        company_industry: 'ELECTRICAL_ELECTRONIC_MANUFACTURING',
      },
      { industry_percentage: 1.17, company_industry: 'INVESTMENT_MANAGEMENT' },
      { industry_percentage: 1.17, company_industry: 'HOSPITAL_HEALTH_CARE' },
      { industry_percentage: 1.04, company_industry: 'CONSUMER_ELECTRONICS' },
      { industry_percentage: 0.91, company_industry: 'EDUCATION_MANAGEMENT' },
      { industry_percentage: 0.91, company_industry: 'CHEMICALS' },
      {
        industry_percentage: 0.91,
        company_industry: 'INFORMATION_TECHNOLOGY_AND_SERVICES',
      },
      { industry_percentage: 0.65, company_industry: 'GRAPHIC_DESIGN' },
      { industry_percentage: 0.65, company_industry: 'HUMAN_RESOURCES' },
      { industry_percentage: 0.52, company_industry: 'ACCOUNTING' },
      { industry_percentage: 0.52, company_industry: 'SEMICONDUCTORS' },
      {
        industry_percentage: 0.52,
        company_industry: 'MARKETING_AND_ADVERTISING',
      },
      { industry_percentage: 0.52, company_industry: 'RETAIL' },
      { industry_percentage: 0.52, company_industry: 'OIL_ENERGY' },
      { industry_percentage: 0.52, company_industry: 'AUTOMOTIVE' },
      { industry_percentage: 0.52, company_industry: 'ENTERTAINMENT' },
      { industry_percentage: 0.52, company_industry: 'INVESTMENT_BANKING' },
      { industry_percentage: 0.52, company_industry: 'DESIGN' },
      { industry_percentage: 0.39, company_industry: 'AIRLINES_AVIATION' },
      { industry_percentage: 0.39, company_industry: '' },
      { industry_percentage: 0.39, company_industry: 'APPAREL_FASHION' },
      {
        industry_percentage: 0.39,
        company_industry: 'TRANSPORTATION_TRUCKING_RAILROAD',
      },
      { industry_percentage: 0.39, company_industry: 'CONSUMER_SERVICES' },
      { industry_percentage: 0.26, company_industry: 'CONSTRUCTION' },
      { industry_percentage: 0.26, company_industry: 'LEGAL_SERVICES' },
      { industry_percentage: 0.26, company_industry: 'FUND_RAISING' },
      {
        industry_percentage: 0.26,
        company_industry: 'LOGISTICS_AND_SUPPLY_CHAIN',
      },
      { industry_percentage: 0.26, company_industry: 'RESTAURANTS' },
      { industry_percentage: 0.26, company_industry: 'BROADCAST_MEDIA' },
      { industry_percentage: 0.26, company_industry: 'MANAGEMENT_CONSULTING' },
      { industry_percentage: 0.26, company_industry: 'MINING_METALS' },
      { industry_percentage: 0.26, company_industry: 'CONSUMER_GOODS' },
      { industry_percentage: 0.26, company_industry: 'LEISURE_TRAVEL_TOURISM' },
      { industry_percentage: 0.26, company_industry: 'REAL_ESTATE' },
      { industry_percentage: 0.26, company_industry: 'FOOD_BEVERAGES' },
      { industry_percentage: 0.26, company_industry: 'BIOTECHNOLOGY' },
      { industry_percentage: 0.26, company_industry: 'COMPUTER_NETWORKING' },
      { industry_percentage: 0.26, company_industry: 'PHARMACEUTICALS' },
      { industry_percentage: 0.13, company_industry: 'HOSPITALITY' },
      { industry_percentage: 0.13, company_industry: 'MARKET_RESEARCH' },
      {
        industry_percentage: 0.13,
        company_industry: 'INTERNATIONAL_TRADE_AND_DEVELOPMENT',
      },
      { industry_percentage: 0.13, company_industry: 'MACHINERY' },
      { industry_percentage: 0.13, company_industry: 'SPORTING_GOODS' },
      { industry_percentage: 0.13, company_industry: 'INFORMATION_SERVICES' },
      {
        industry_percentage: 0.13,
        company_industry: 'PUBLIC_RELATIONS_AND_COMMUNICATIONS',
      },
      {
        industry_percentage: 0.13,
        company_industry: 'HEALTH_WELLNESS_AND_FITNESS',
      },
      { industry_percentage: 0.13, company_industry: 'CIVIL_ENGINEERING' },
      { industry_percentage: 0.13, company_industry: 'PAPER_FOREST_PRODUCTS' },
      { industry_percentage: 0.13, company_industry: 'LUXURY_GOODS_JEWELRY' },
      { industry_percentage: 0.13, company_industry: 'WHOLESALE' },
      { industry_percentage: 0.13, company_industry: 'UTILITIES' },
      { industry_percentage: 0.13, company_industry: 'DEFENSE_SPACE' },
      { industry_percentage: 0.13, company_industry: 'MARITIME' },
      { industry_percentage: 0.13, company_industry: 'ONLINE_MEDIA' },
      { industry_percentage: 0.13, company_industry: 'TEXTILES' },
      { industry_percentage: 0.13, company_industry: 'RENEWABLES_ENVIRONMENT' },
      { industry_percentage: 0.13, company_industry: 'FOOD_PRODUCTION' },
      {
        industry_percentage: 0.13,
        company_industry: 'SECURITY_AND_INVESTIGATIONS',
      },
      {
        industry_percentage: 0.13,
        company_industry: 'VENTURE_CAPITAL_PRIVATE_EQUITY',
      },
    ],
  },
  mark: { type: 'arc', innerRadius: 60 },
  encoding: {
    theta: { field: 'industry_percentage', type: 'quantitative' },
    color: { field: 'company_industry', type: 'nominal' },
  },
};

const spec3 = {
  $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
  data: {
    values: [
      {
        symbol: 'MSFT',
        date: 'Jan 1 2000',
        price: 39.81,
      },
      {
        symbol: 'MSFT',
        date: 'Feb 1 2000',
        price: 36.35,
      },
      {
        symbol: 'MSFT',
        date: 'Mar 1 2000',
        price: 43.22,
      },
      {
        symbol: 'MSFT',
        date: 'Apr 1 2000',
        price: 28.37,
      },
      {
        symbol: 'MSFT',
        date: 'May 1 2000',
        price: 25.45,
      },
      {
        symbol: 'MSFT',
        date: 'Jun 1 2000',
        price: 32.54,
      },
      {
        symbol: 'MSFT',
        date: 'Jul 1 2000',
        price: 28.4,
      },
      {
        symbol: 'MSFT',
        date: 'Aug 1 2000',
        price: 28.4,
      },
      {
        symbol: 'MSFT',
        date: 'Sep 1 2000',
        price: 24.53,
      },
      {
        symbol: 'MSFT',
        date: 'Oct 1 2000',
        price: 28.02,
      },
      {
        symbol: 'MSFT',
        date: 'Nov 1 2000',
        price: 23.34,
      },
      {
        symbol: 'MSFT',
        date: 'Dec 1 2000',
        price: 17.65,
      },
      {
        symbol: 'MSFT',
        date: 'Jan 1 2001',
        price: 24.84,
      },
      {
        symbol: 'MSFT',
        date: 'Feb 1 2001',
        price: 24,
      },
      {
        symbol: 'MSFT',
        date: 'Mar 1 2001',
        price: 22.25,
      },
      {
        symbol: 'MSFT',
        date: 'Apr 1 2001',
        price: 27.56,
      },
      {
        symbol: 'MSFT',
        date: 'May 1 2001',
        price: 28.14,
      },
      {
        symbol: 'MSFT',
        date: 'Jun 1 2001',
        price: 29.7,
      },
      {
        symbol: 'MSFT',
        date: 'Jul 1 2001',
        price: 26.93,
      },
      {
        symbol: 'MSFT',
        date: 'Aug 1 2001',
        price: 23.21,
      },
      {
        symbol: 'MSFT',
        date: 'Sep 1 2001',
        price: 20.82,
      },
      {
        symbol: 'MSFT',
        date: 'Oct 1 2001',
        price: 23.65,
      },
      {
        symbol: 'MSFT',
        date: 'Nov 1 2001',
        price: 26.12,
      },
      {
        symbol: 'MSFT',
        date: 'Dec 1 2001',
        price: 26.95,
      },
      {
        symbol: 'MSFT',
        date: 'Jan 1 2002',
        price: 25.92,
      },
      {
        symbol: 'MSFT',
        date: 'Feb 1 2002',
        price: 23.73,
      },
      {
        symbol: 'MSFT',
        date: 'Mar 1 2002',
        price: 24.53,
      },
      {
        symbol: 'MSFT',
        date: 'Apr 1 2002',
        price: 21.26,
      },
      {
        symbol: 'MSFT',
        date: 'May 1 2002',
        price: 20.71,
      },
      {
        symbol: 'MSFT',
        date: 'Jun 1 2002',
        price: 22.25,
      },
      {
        symbol: 'MSFT',
        date: 'Jul 1 2002',
        price: 19.52,
      },
      {
        symbol: 'MSFT',
        date: 'Aug 1 2002',
        price: 19.97,
      },
      {
        symbol: 'MSFT',
        date: 'Sep 1 2002',
        price: 17.79,
      },
      {
        symbol: 'MSFT',
        date: 'Oct 1 2002',
        price: 21.75,
      },
      {
        symbol: 'MSFT',
        date: 'Nov 1 2002',
        price: 23.46,
      },
      {
        symbol: 'MSFT',
        date: 'Dec 1 2002',
        price: 21.03,
      },
      {
        symbol: 'MSFT',
        date: 'Jan 1 2003',
        price: 19.31,
      },
      {
        symbol: 'MSFT',
        date: 'Feb 1 2003',
        price: 19.34,
      },
      {
        symbol: 'MSFT',
        date: 'Mar 1 2003',
        price: 19.76,
      },
      {
        symbol: 'MSFT',
        date: 'Apr 1 2003',
        price: 20.87,
      },
      {
        symbol: 'MSFT',
        date: 'May 1 2003',
        price: 20.09,
      },
      {
        symbol: 'MSFT',
        date: 'Jun 1 2003',
        price: 20.93,
      },
      {
        symbol: 'MSFT',
        date: 'Jul 1 2003',
        price: 21.56,
      },
      {
        symbol: 'MSFT',
        date: 'Aug 1 2003',
        price: 21.65,
      },
      {
        symbol: 'MSFT',
        date: 'Sep 1 2003',
        price: 22.69,
      },
      {
        symbol: 'MSFT',
        date: 'Oct 1 2003',
        price: 21.45,
      },
      {
        symbol: 'MSFT',
        date: 'Nov 1 2003',
        price: 21.1,
      },
      {
        symbol: 'MSFT',
        date: 'Dec 1 2003',
        price: 22.46,
      },
      {
        symbol: 'MSFT',
        date: 'Jan 1 2004',
        price: 22.69,
      },
      {
        symbol: 'MSFT',
        date: 'Feb 1 2004',
        price: 21.77,
      },
      {
        symbol: 'MSFT',
        date: 'Mar 1 2004',
        price: 20.46,
      },
      {
        symbol: 'MSFT',
        date: 'Apr 1 2004',
        price: 21.45,
      },
      {
        symbol: 'MSFT',
        date: 'May 1 2004',
        price: 21.53,
      },
      {
        symbol: 'MSFT',
        date: 'Jun 1 2004',
        price: 23.44,
      },
      {
        symbol: 'MSFT',
        date: 'Jul 1 2004',
        price: 23.38,
      },
      {
        symbol: 'MSFT',
        date: 'Aug 1 2004',
        price: 22.47,
      },
      {
        symbol: 'MSFT',
        date: 'Sep 1 2004',
        price: 22.76,
      },
      {
        symbol: 'MSFT',
        date: 'Oct 1 2004',
        price: 23.02,
      },
      {
        symbol: 'MSFT',
        date: 'Nov 1 2004',
        price: 24.6,
      },
      {
        symbol: 'MSFT',
        date: 'Dec 1 2004',
        price: 24.52,
      },
      {
        symbol: 'MSFT',
        date: 'Jan 1 2005',
        price: 24.11,
      },
      {
        symbol: 'MSFT',
        date: 'Feb 1 2005',
        price: 23.15,
      },
      {
        symbol: 'MSFT',
        date: 'Mar 1 2005',
        price: 22.24,
      },
      {
        symbol: 'MSFT',
        date: 'Apr 1 2005',
        price: 23.28,
      },
      {
        symbol: 'MSFT',
        date: 'May 1 2005',
        price: 23.82,
      },
      {
        symbol: 'MSFT',
        date: 'Jun 1 2005',
        price: 22.93,
      },
      {
        symbol: 'MSFT',
        date: 'Jul 1 2005',
        price: 23.64,
      },
      {
        symbol: 'MSFT',
        date: 'Aug 1 2005',
        price: 25.35,
      },
      {
        symbol: 'MSFT',
        date: 'Sep 1 2005',
        price: 23.83,
      },
      {
        symbol: 'MSFT',
        date: 'Oct 1 2005',
        price: 23.8,
      },
      {
        symbol: 'MSFT',
        date: 'Nov 1 2005',
        price: 25.71,
      },
      {
        symbol: 'MSFT',
        date: 'Dec 1 2005',
        price: 24.29,
      },
      {
        symbol: 'MSFT',
        date: 'Jan 1 2006',
        price: 26.14,
      },
      {
        symbol: 'MSFT',
        date: 'Feb 1 2006',
        price: 25.04,
      },
      {
        symbol: 'MSFT',
        date: 'Mar 1 2006',
        price: 25.36,
      },
      {
        symbol: 'MSFT',
        date: 'Apr 1 2006',
        price: 22.5,
      },
      {
        symbol: 'MSFT',
        date: 'May 1 2006',
        price: 21.19,
      },
      {
        symbol: 'MSFT',
        date: 'Jun 1 2006',
        price: 21.8,
      },
      {
        symbol: 'MSFT',
        date: 'Jul 1 2006',
        price: 22.51,
      },
      {
        symbol: 'MSFT',
        date: 'Aug 1 2006',
        price: 24.13,
      },
      {
        symbol: 'MSFT',
        date: 'Sep 1 2006',
        price: 25.68,
      },
      {
        symbol: 'MSFT',
        date: 'Oct 1 2006',
        price: 26.96,
      },
      {
        symbol: 'MSFT',
        date: 'Nov 1 2006',
        price: 27.66,
      },
      {
        symbol: 'MSFT',
        date: 'Dec 1 2006',
        price: 28.13,
      },
      {
        symbol: 'MSFT',
        date: 'Jan 1 2007',
        price: 29.07,
      },
      {
        symbol: 'MSFT',
        date: 'Feb 1 2007',
        price: 26.63,
      },
      {
        symbol: 'MSFT',
        date: 'Mar 1 2007',
        price: 26.35,
      },
      {
        symbol: 'MSFT',
        date: 'Apr 1 2007',
        price: 28.3,
      },
      {
        symbol: 'MSFT',
        date: 'May 1 2007',
        price: 29.11,
      },
      {
        symbol: 'MSFT',
        date: 'Jun 1 2007',
        price: 27.95,
      },
      {
        symbol: 'MSFT',
        date: 'Jul 1 2007',
        price: 27.5,
      },
      {
        symbol: 'MSFT',
        date: 'Aug 1 2007',
        price: 27.34,
      },
      {
        symbol: 'MSFT',
        date: 'Sep 1 2007',
        price: 28.04,
      },
      {
        symbol: 'MSFT',
        date: 'Oct 1 2007',
        price: 35.03,
      },
      {
        symbol: 'MSFT',
        date: 'Nov 1 2007',
        price: 32.09,
      },
      {
        symbol: 'MSFT',
        date: 'Dec 1 2007',
        price: 34,
      },
      {
        symbol: 'MSFT',
        date: 'Jan 1 2008',
        price: 31.13,
      },
      {
        symbol: 'MSFT',
        date: 'Feb 1 2008',
        price: 26.07,
      },
      {
        symbol: 'MSFT',
        date: 'Mar 1 2008',
        price: 27.21,
      },
      {
        symbol: 'MSFT',
        date: 'Apr 1 2008',
        price: 27.34,
      },
      {
        symbol: 'MSFT',
        date: 'May 1 2008',
        price: 27.25,
      },
      {
        symbol: 'MSFT',
        date: 'Jun 1 2008',
        price: 26.47,
      },
      {
        symbol: 'MSFT',
        date: 'Jul 1 2008',
        price: 24.75,
      },
      {
        symbol: 'MSFT',
        date: 'Aug 1 2008',
        price: 26.36,
      },
      {
        symbol: 'MSFT',
        date: 'Sep 1 2008',
        price: 25.78,
      },
      {
        symbol: 'MSFT',
        date: 'Oct 1 2008',
        price: 21.57,
      },
      {
        symbol: 'MSFT',
        date: 'Nov 1 2008',
        price: 19.66,
      },
      {
        symbol: 'MSFT',
        date: 'Dec 1 2008',
        price: 18.91,
      },
      {
        symbol: 'MSFT',
        date: 'Jan 1 2009',
        price: 16.63,
      },
      {
        symbol: 'MSFT',
        date: 'Feb 1 2009',
        price: 15.81,
      },
      {
        symbol: 'MSFT',
        date: 'Mar 1 2009',
        price: 17.99,
      },
      {
        symbol: 'MSFT',
        date: 'Apr 1 2009',
        price: 19.84,
      },
      {
        symbol: 'MSFT',
        date: 'May 1 2009',
        price: 20.59,
      },
      {
        symbol: 'MSFT',
        date: 'Jun 1 2009',
        price: 23.42,
      },
      {
        symbol: 'MSFT',
        date: 'Jul 1 2009',
        price: 23.18,
      },
      {
        symbol: 'MSFT',
        date: 'Aug 1 2009',
        price: 24.43,
      },
      {
        symbol: 'MSFT',
        date: 'Sep 1 2009',
        price: 25.49,
      },
      {
        symbol: 'MSFT',
        date: 'Oct 1 2009',
        price: 27.48,
      },
      {
        symbol: 'MSFT',
        date: 'Nov 1 2009',
        price: 29.27,
      },
      {
        symbol: 'MSFT',
        date: 'Dec 1 2009',
        price: 30.34,
      },
      {
        symbol: 'MSFT',
        date: 'Jan 1 2010',
        price: 28.05,
      },
      {
        symbol: 'MSFT',
        date: 'Feb 1 2010',
        price: 28.67,
      },
      {
        symbol: 'MSFT',
        date: 'Mar 1 2010',
        price: 28.8,
      },
      {
        symbol: 'AMZN',
        date: 'Jan 1 2000',
        price: 64.56,
      },
      {
        symbol: 'AMZN',
        date: 'Feb 1 2000',
        price: 68.87,
      },
      {
        symbol: 'AMZN',
        date: 'Mar 1 2000',
        price: 67,
      },
      {
        symbol: 'AMZN',
        date: 'Apr 1 2000',
        price: 55.19,
      },
      {
        symbol: 'AMZN',
        date: 'May 1 2000',
        price: 48.31,
      },
      {
        symbol: 'AMZN',
        date: 'Jun 1 2000',
        price: 36.31,
      },
      {
        symbol: 'AMZN',
        date: 'Jul 1 2000',
        price: 30.12,
      },
      {
        symbol: 'AMZN',
        date: 'Aug 1 2000',
        price: 41.5,
      },
      {
        symbol: 'AMZN',
        date: 'Sep 1 2000',
        price: 38.44,
      },
      {
        symbol: 'AMZN',
        date: 'Oct 1 2000',
        price: 36.62,
      },
      {
        symbol: 'AMZN',
        date: 'Nov 1 2000',
        price: 24.69,
      },
      {
        symbol: 'AMZN',
        date: 'Dec 1 2000',
        price: 15.56,
      },
      {
        symbol: 'AMZN',
        date: 'Jan 1 2001',
        price: 17.31,
      },
      {
        symbol: 'AMZN',
        date: 'Feb 1 2001',
        price: 10.19,
      },
      {
        symbol: 'AMZN',
        date: 'Mar 1 2001',
        price: 10.23,
      },
      {
        symbol: 'AMZN',
        date: 'Apr 1 2001',
        price: 15.78,
      },
      {
        symbol: 'AMZN',
        date: 'May 1 2001',
        price: 16.69,
      },
      {
        symbol: 'AMZN',
        date: 'Jun 1 2001',
        price: 14.15,
      },
      {
        symbol: 'AMZN',
        date: 'Jul 1 2001',
        price: 12.49,
      },
      {
        symbol: 'AMZN',
        date: 'Aug 1 2001',
        price: 8.94,
      },
      {
        symbol: 'AMZN',
        date: 'Sep 1 2001',
        price: 5.97,
      },
      {
        symbol: 'AMZN',
        date: 'Oct 1 2001',
        price: 6.98,
      },
      {
        symbol: 'AMZN',
        date: 'Nov 1 2001',
        price: 11.32,
      },
      {
        symbol: 'AMZN',
        date: 'Dec 1 2001',
        price: 10.82,
      },
      {
        symbol: 'AMZN',
        date: 'Jan 1 2002',
        price: 14.19,
      },
      {
        symbol: 'AMZN',
        date: 'Feb 1 2002',
        price: 14.1,
      },
      {
        symbol: 'AMZN',
        date: 'Mar 1 2002',
        price: 14.3,
      },
      {
        symbol: 'AMZN',
        date: 'Apr 1 2002',
        price: 16.69,
      },
      {
        symbol: 'AMZN',
        date: 'May 1 2002',
        price: 18.23,
      },
      {
        symbol: 'AMZN',
        date: 'Jun 1 2002',
        price: 16.25,
      },
      {
        symbol: 'AMZN',
        date: 'Jul 1 2002',
        price: 14.45,
      },
      {
        symbol: 'AMZN',
        date: 'Aug 1 2002',
        price: 14.94,
      },
      {
        symbol: 'AMZN',
        date: 'Sep 1 2002',
        price: 15.93,
      },
      {
        symbol: 'AMZN',
        date: 'Oct 1 2002',
        price: 19.36,
      },
      {
        symbol: 'AMZN',
        date: 'Nov 1 2002',
        price: 23.35,
      },
      {
        symbol: 'AMZN',
        date: 'Dec 1 2002',
        price: 18.89,
      },
      {
        symbol: 'AMZN',
        date: 'Jan 1 2003',
        price: 21.85,
      },
      {
        symbol: 'AMZN',
        date: 'Feb 1 2003',
        price: 22.01,
      },
      {
        symbol: 'AMZN',
        date: 'Mar 1 2003',
        price: 26.03,
      },
      {
        symbol: 'AMZN',
        date: 'Apr 1 2003',
        price: 28.69,
      },
      {
        symbol: 'AMZN',
        date: 'May 1 2003',
        price: 35.89,
      },
      {
        symbol: 'AMZN',
        date: 'Jun 1 2003',
        price: 36.32,
      },
      {
        symbol: 'AMZN',
        date: 'Jul 1 2003',
        price: 41.64,
      },
      {
        symbol: 'AMZN',
        date: 'Aug 1 2003',
        price: 46.32,
      },
      {
        symbol: 'AMZN',
        date: 'Sep 1 2003',
        price: 48.43,
      },
      {
        symbol: 'AMZN',
        date: 'Oct 1 2003',
        price: 54.43,
      },
      {
        symbol: 'AMZN',
        date: 'Nov 1 2003',
        price: 53.97,
      },
      {
        symbol: 'AMZN',
        date: 'Dec 1 2003',
        price: 52.62,
      },
      {
        symbol: 'AMZN',
        date: 'Jan 1 2004',
        price: 50.4,
      },
      {
        symbol: 'AMZN',
        date: 'Feb 1 2004',
        price: 43.01,
      },
      {
        symbol: 'AMZN',
        date: 'Mar 1 2004',
        price: 43.28,
      },
      {
        symbol: 'AMZN',
        date: 'Apr 1 2004',
        price: 43.6,
      },
      {
        symbol: 'AMZN',
        date: 'May 1 2004',
        price: 48.5,
      },
      {
        symbol: 'AMZN',
        date: 'Jun 1 2004',
        price: 54.4,
      },
      {
        symbol: 'AMZN',
        date: 'Jul 1 2004',
        price: 38.92,
      },
      {
        symbol: 'AMZN',
        date: 'Aug 1 2004',
        price: 38.14,
      },
      {
        symbol: 'AMZN',
        date: 'Sep 1 2004',
        price: 40.86,
      },
      {
        symbol: 'AMZN',
        date: 'Oct 1 2004',
        price: 34.13,
      },
      {
        symbol: 'AMZN',
        date: 'Nov 1 2004',
        price: 39.68,
      },
      {
        symbol: 'AMZN',
        date: 'Dec 1 2004',
        price: 44.29,
      },
      {
        symbol: 'AMZN',
        date: 'Jan 1 2005',
        price: 43.22,
      },
      {
        symbol: 'AMZN',
        date: 'Feb 1 2005',
        price: 35.18,
      },
      {
        symbol: 'AMZN',
        date: 'Mar 1 2005',
        price: 34.27,
      },
      {
        symbol: 'AMZN',
        date: 'Apr 1 2005',
        price: 32.36,
      },
      {
        symbol: 'AMZN',
        date: 'May 1 2005',
        price: 35.51,
      },
      {
        symbol: 'AMZN',
        date: 'Jun 1 2005',
        price: 33.09,
      },
      {
        symbol: 'AMZN',
        date: 'Jul 1 2005',
        price: 45.15,
      },
      {
        symbol: 'AMZN',
        date: 'Aug 1 2005',
        price: 42.7,
      },
      {
        symbol: 'AMZN',
        date: 'Sep 1 2005',
        price: 45.3,
      },
      {
        symbol: 'AMZN',
        date: 'Oct 1 2005',
        price: 39.86,
      },
      {
        symbol: 'AMZN',
        date: 'Nov 1 2005',
        price: 48.46,
      },
      {
        symbol: 'AMZN',
        date: 'Dec 1 2005',
        price: 47.15,
      },
      {
        symbol: 'AMZN',
        date: 'Jan 1 2006',
        price: 44.82,
      },
      {
        symbol: 'AMZN',
        date: 'Feb 1 2006',
        price: 37.44,
      },
      {
        symbol: 'AMZN',
        date: 'Mar 1 2006',
        price: 36.53,
      },
      {
        symbol: 'AMZN',
        date: 'Apr 1 2006',
        price: 35.21,
      },
      {
        symbol: 'AMZN',
        date: 'May 1 2006',
        price: 34.61,
      },
      {
        symbol: 'AMZN',
        date: 'Jun 1 2006',
        price: 38.68,
      },
      {
        symbol: 'AMZN',
        date: 'Jul 1 2006',
        price: 26.89,
      },
      {
        symbol: 'AMZN',
        date: 'Aug 1 2006',
        price: 30.83,
      },
      {
        symbol: 'AMZN',
        date: 'Sep 1 2006',
        price: 32.12,
      },
      {
        symbol: 'AMZN',
        date: 'Oct 1 2006',
        price: 38.09,
      },
      {
        symbol: 'AMZN',
        date: 'Nov 1 2006',
        price: 40.34,
      },
      {
        symbol: 'AMZN',
        date: 'Dec 1 2006',
        price: 39.46,
      },
      {
        symbol: 'AMZN',
        date: 'Jan 1 2007',
        price: 37.67,
      },
      {
        symbol: 'AMZN',
        date: 'Feb 1 2007',
        price: 39.14,
      },
      {
        symbol: 'AMZN',
        date: 'Mar 1 2007',
        price: 39.79,
      },
      {
        symbol: 'AMZN',
        date: 'Apr 1 2007',
        price: 61.33,
      },
      {
        symbol: 'AMZN',
        date: 'May 1 2007',
        price: 69.14,
      },
      {
        symbol: 'AMZN',
        date: 'Jun 1 2007',
        price: 68.41,
      },
      {
        symbol: 'AMZN',
        date: 'Jul 1 2007',
        price: 78.54,
      },
      {
        symbol: 'AMZN',
        date: 'Aug 1 2007',
        price: 79.91,
      },
      {
        symbol: 'AMZN',
        date: 'Sep 1 2007',
        price: 93.15,
      },
      {
        symbol: 'AMZN',
        date: 'Oct 1 2007',
        price: 89.15,
      },
      {
        symbol: 'AMZN',
        date: 'Nov 1 2007',
        price: 90.56,
      },
      {
        symbol: 'AMZN',
        date: 'Dec 1 2007',
        price: 92.64,
      },
      {
        symbol: 'AMZN',
        date: 'Jan 1 2008',
        price: 77.7,
      },
      {
        symbol: 'AMZN',
        date: 'Feb 1 2008',
        price: 64.47,
      },
      {
        symbol: 'AMZN',
        date: 'Mar 1 2008',
        price: 71.3,
      },
      {
        symbol: 'AMZN',
        date: 'Apr 1 2008',
        price: 78.63,
      },
      {
        symbol: 'AMZN',
        date: 'May 1 2008',
        price: 81.62,
      },
      {
        symbol: 'AMZN',
        date: 'Jun 1 2008',
        price: 73.33,
      },
      {
        symbol: 'AMZN',
        date: 'Jul 1 2008',
        price: 76.34,
      },
      {
        symbol: 'AMZN',
        date: 'Aug 1 2008',
        price: 80.81,
      },
      {
        symbol: 'AMZN',
        date: 'Sep 1 2008',
        price: 72.76,
      },
      {
        symbol: 'AMZN',
        date: 'Oct 1 2008',
        price: 57.24,
      },
      {
        symbol: 'AMZN',
        date: 'Nov 1 2008',
        price: 42.7,
      },
      {
        symbol: 'AMZN',
        date: 'Dec 1 2008',
        price: 51.28,
      },
      {
        symbol: 'AMZN',
        date: 'Jan 1 2009',
        price: 58.82,
      },
      {
        symbol: 'AMZN',
        date: 'Feb 1 2009',
        price: 64.79,
      },
      {
        symbol: 'AMZN',
        date: 'Mar 1 2009',
        price: 73.44,
      },
      {
        symbol: 'AMZN',
        date: 'Apr 1 2009',
        price: 80.52,
      },
      {
        symbol: 'AMZN',
        date: 'May 1 2009',
        price: 77.99,
      },
      {
        symbol: 'AMZN',
        date: 'Jun 1 2009',
        price: 83.66,
      },
      {
        symbol: 'AMZN',
        date: 'Jul 1 2009',
        price: 85.76,
      },
      {
        symbol: 'AMZN',
        date: 'Aug 1 2009',
        price: 81.19,
      },
      {
        symbol: 'AMZN',
        date: 'Sep 1 2009',
        price: 93.36,
      },
      {
        symbol: 'AMZN',
        date: 'Oct 1 2009',
        price: 118.81,
      },
      {
        symbol: 'AMZN',
        date: 'Nov 1 2009',
        price: 135.91,
      },
      {
        symbol: 'AMZN',
        date: 'Dec 1 2009',
        price: 134.52,
      },
      {
        symbol: 'AMZN',
        date: 'Jan 1 2010',
        price: 125.41,
      },
      {
        symbol: 'AMZN',
        date: 'Feb 1 2010',
        price: 118.4,
      },
      {
        symbol: 'AMZN',
        date: 'Mar 1 2010',
        price: 128.82,
      },
      {
        symbol: 'IBM',
        date: 'Jan 1 2000',
        price: 100.52,
      },
      {
        symbol: 'IBM',
        date: 'Feb 1 2000',
        price: 92.11,
      },
      {
        symbol: 'IBM',
        date: 'Mar 1 2000',
        price: 106.11,
      },
      {
        symbol: 'IBM',
        date: 'Apr 1 2000',
        price: 99.95,
      },
      {
        symbol: 'IBM',
        date: 'May 1 2000',
        price: 96.31,
      },
      {
        symbol: 'IBM',
        date: 'Jun 1 2000',
        price: 98.33,
      },
      {
        symbol: 'IBM',
        date: 'Jul 1 2000',
        price: 100.74,
      },
      {
        symbol: 'IBM',
        date: 'Aug 1 2000',
        price: 118.62,
      },
      {
        symbol: 'IBM',
        date: 'Sep 1 2000',
        price: 101.19,
      },
      {
        symbol: 'IBM',
        date: 'Oct 1 2000',
        price: 88.5,
      },
      {
        symbol: 'IBM',
        date: 'Nov 1 2000',
        price: 84.12,
      },
      {
        symbol: 'IBM',
        date: 'Dec 1 2000',
        price: 76.47,
      },
      {
        symbol: 'IBM',
        date: 'Jan 1 2001',
        price: 100.76,
      },
      {
        symbol: 'IBM',
        date: 'Feb 1 2001',
        price: 89.98,
      },
      {
        symbol: 'IBM',
        date: 'Mar 1 2001',
        price: 86.63,
      },
      {
        symbol: 'IBM',
        date: 'Apr 1 2001',
        price: 103.7,
      },
      {
        symbol: 'IBM',
        date: 'May 1 2001',
        price: 100.82,
      },
      {
        symbol: 'IBM',
        date: 'Jun 1 2001',
        price: 102.35,
      },
      {
        symbol: 'IBM',
        date: 'Jul 1 2001',
        price: 94.87,
      },
      {
        symbol: 'IBM',
        date: 'Aug 1 2001',
        price: 90.25,
      },
      {
        symbol: 'IBM',
        date: 'Sep 1 2001',
        price: 82.82,
      },
      {
        symbol: 'IBM',
        date: 'Oct 1 2001',
        price: 97.58,
      },
      {
        symbol: 'IBM',
        date: 'Nov 1 2001',
        price: 104.5,
      },
      {
        symbol: 'IBM',
        date: 'Dec 1 2001',
        price: 109.36,
      },
      {
        symbol: 'IBM',
        date: 'Jan 1 2002',
        price: 97.54,
      },
      {
        symbol: 'IBM',
        date: 'Feb 1 2002',
        price: 88.82,
      },
      {
        symbol: 'IBM',
        date: 'Mar 1 2002',
        price: 94.15,
      },
      {
        symbol: 'IBM',
        date: 'Apr 1 2002',
        price: 75.82,
      },
      {
        symbol: 'IBM',
        date: 'May 1 2002',
        price: 72.97,
      },
      {
        symbol: 'IBM',
        date: 'Jun 1 2002',
        price: 65.31,
      },
      {
        symbol: 'IBM',
        date: 'Jul 1 2002',
        price: 63.86,
      },
      {
        symbol: 'IBM',
        date: 'Aug 1 2002',
        price: 68.52,
      },
      {
        symbol: 'IBM',
        date: 'Sep 1 2002',
        price: 53.01,
      },
      {
        symbol: 'IBM',
        date: 'Oct 1 2002',
        price: 71.76,
      },
      {
        symbol: 'IBM',
        date: 'Nov 1 2002',
        price: 79.16,
      },
      {
        symbol: 'IBM',
        date: 'Dec 1 2002',
        price: 70.58,
      },
      {
        symbol: 'IBM',
        date: 'Jan 1 2003',
        price: 71.22,
      },
      {
        symbol: 'IBM',
        date: 'Feb 1 2003',
        price: 71.13,
      },
      {
        symbol: 'IBM',
        date: 'Mar 1 2003',
        price: 71.57,
      },
      {
        symbol: 'IBM',
        date: 'Apr 1 2003',
        price: 77.47,
      },
      {
        symbol: 'IBM',
        date: 'May 1 2003',
        price: 80.48,
      },
      {
        symbol: 'IBM',
        date: 'Jun 1 2003',
        price: 75.42,
      },
      {
        symbol: 'IBM',
        date: 'Jul 1 2003',
        price: 74.28,
      },
      {
        symbol: 'IBM',
        date: 'Aug 1 2003',
        price: 75.12,
      },
      {
        symbol: 'IBM',
        date: 'Sep 1 2003',
        price: 80.91,
      },
      {
        symbol: 'IBM',
        date: 'Oct 1 2003',
        price: 81.96,
      },
      {
        symbol: 'IBM',
        date: 'Nov 1 2003',
        price: 83.08,
      },
      {
        symbol: 'IBM',
        date: 'Dec 1 2003',
        price: 85.05,
      },
      {
        symbol: 'IBM',
        date: 'Jan 1 2004',
        price: 91.06,
      },
      {
        symbol: 'IBM',
        date: 'Feb 1 2004',
        price: 88.7,
      },
      {
        symbol: 'IBM',
        date: 'Mar 1 2004',
        price: 84.41,
      },
      {
        symbol: 'IBM',
        date: 'Apr 1 2004',
        price: 81.04,
      },
      {
        symbol: 'IBM',
        date: 'May 1 2004',
        price: 81.59,
      },
      {
        symbol: 'IBM',
        date: 'Jun 1 2004',
        price: 81.19,
      },
      {
        symbol: 'IBM',
        date: 'Jul 1 2004',
        price: 80.19,
      },
      {
        symbol: 'IBM',
        date: 'Aug 1 2004',
        price: 78.17,
      },
      {
        symbol: 'IBM',
        date: 'Sep 1 2004',
        price: 79.13,
      },
      {
        symbol: 'IBM',
        date: 'Oct 1 2004',
        price: 82.84,
      },
      {
        symbol: 'IBM',
        date: 'Nov 1 2004',
        price: 87.15,
      },
      {
        symbol: 'IBM',
        date: 'Dec 1 2004',
        price: 91.16,
      },
      {
        symbol: 'IBM',
        date: 'Jan 1 2005',
        price: 86.39,
      },
      {
        symbol: 'IBM',
        date: 'Feb 1 2005',
        price: 85.78,
      },
      {
        symbol: 'IBM',
        date: 'Mar 1 2005',
        price: 84.66,
      },
      {
        symbol: 'IBM',
        date: 'Apr 1 2005',
        price: 70.77,
      },
      {
        symbol: 'IBM',
        date: 'May 1 2005',
        price: 70.18,
      },
      {
        symbol: 'IBM',
        date: 'Jun 1 2005',
        price: 68.93,
      },
      {
        symbol: 'IBM',
        date: 'Jul 1 2005',
        price: 77.53,
      },
      {
        symbol: 'IBM',
        date: 'Aug 1 2005',
        price: 75.07,
      },
      {
        symbol: 'IBM',
        date: 'Sep 1 2005',
        price: 74.7,
      },
      {
        symbol: 'IBM',
        date: 'Oct 1 2005',
        price: 76.25,
      },
      {
        symbol: 'IBM',
        date: 'Nov 1 2005',
        price: 82.98,
      },
      {
        symbol: 'IBM',
        date: 'Dec 1 2005',
        price: 76.73,
      },
      {
        symbol: 'IBM',
        date: 'Jan 1 2006',
        price: 75.89,
      },
      {
        symbol: 'IBM',
        date: 'Feb 1 2006',
        price: 75.09,
      },
      {
        symbol: 'IBM',
        date: 'Mar 1 2006',
        price: 77.17,
      },
      {
        symbol: 'IBM',
        date: 'Apr 1 2006',
        price: 77.05,
      },
      {
        symbol: 'IBM',
        date: 'May 1 2006',
        price: 75.04,
      },
      {
        symbol: 'IBM',
        date: 'Jun 1 2006',
        price: 72.15,
      },
      {
        symbol: 'IBM',
        date: 'Jul 1 2006',
        price: 72.7,
      },
      {
        symbol: 'IBM',
        date: 'Aug 1 2006',
        price: 76.35,
      },
      {
        symbol: 'IBM',
        date: 'Sep 1 2006',
        price: 77.26,
      },
      {
        symbol: 'IBM',
        date: 'Oct 1 2006',
        price: 87.06,
      },
      {
        symbol: 'IBM',
        date: 'Nov 1 2006',
        price: 86.95,
      },
      {
        symbol: 'IBM',
        date: 'Dec 1 2006',
        price: 91.9,
      },
      {
        symbol: 'IBM',
        date: 'Jan 1 2007',
        price: 93.79,
      },
      {
        symbol: 'IBM',
        date: 'Feb 1 2007',
        price: 88.18,
      },
      {
        symbol: 'IBM',
        date: 'Mar 1 2007',
        price: 89.44,
      },
      {
        symbol: 'IBM',
        date: 'Apr 1 2007',
        price: 96.98,
      },
      {
        symbol: 'IBM',
        date: 'May 1 2007',
        price: 101.54,
      },
      {
        symbol: 'IBM',
        date: 'Jun 1 2007',
        price: 100.25,
      },
      {
        symbol: 'IBM',
        date: 'Jul 1 2007',
        price: 105.4,
      },
      {
        symbol: 'IBM',
        date: 'Aug 1 2007',
        price: 111.54,
      },
      {
        symbol: 'IBM',
        date: 'Sep 1 2007',
        price: 112.6,
      },
      {
        symbol: 'IBM',
        date: 'Oct 1 2007',
        price: 111,
      },
      {
        symbol: 'IBM',
        date: 'Nov 1 2007',
        price: 100.9,
      },
      {
        symbol: 'IBM',
        date: 'Dec 1 2007',
        price: 103.7,
      },
      {
        symbol: 'IBM',
        date: 'Jan 1 2008',
        price: 102.75,
      },
      {
        symbol: 'IBM',
        date: 'Feb 1 2008',
        price: 109.64,
      },
      {
        symbol: 'IBM',
        date: 'Mar 1 2008',
        price: 110.87,
      },
      {
        symbol: 'IBM',
        date: 'Apr 1 2008',
        price: 116.23,
      },
      {
        symbol: 'IBM',
        date: 'May 1 2008',
        price: 125.14,
      },
      {
        symbol: 'IBM',
        date: 'Jun 1 2008',
        price: 114.6,
      },
      {
        symbol: 'IBM',
        date: 'Jul 1 2008',
        price: 123.74,
      },
      {
        symbol: 'IBM',
        date: 'Aug 1 2008',
        price: 118.16,
      },
      {
        symbol: 'IBM',
        date: 'Sep 1 2008',
        price: 113.53,
      },
      {
        symbol: 'IBM',
        date: 'Oct 1 2008',
        price: 90.24,
      },
      {
        symbol: 'IBM',
        date: 'Nov 1 2008',
        price: 79.65,
      },
      {
        symbol: 'IBM',
        date: 'Dec 1 2008',
        price: 82.15,
      },
      {
        symbol: 'IBM',
        date: 'Jan 1 2009',
        price: 89.46,
      },
      {
        symbol: 'IBM',
        date: 'Feb 1 2009',
        price: 90.32,
      },
      {
        symbol: 'IBM',
        date: 'Mar 1 2009',
        price: 95.09,
      },
      {
        symbol: 'IBM',
        date: 'Apr 1 2009',
        price: 101.29,
      },
      {
        symbol: 'IBM',
        date: 'May 1 2009',
        price: 104.85,
      },
      {
        symbol: 'IBM',
        date: 'Jun 1 2009',
        price: 103.01,
      },
      {
        symbol: 'IBM',
        date: 'Jul 1 2009',
        price: 116.34,
      },
      {
        symbol: 'IBM',
        date: 'Aug 1 2009',
        price: 117,
      },
      {
        symbol: 'IBM',
        date: 'Sep 1 2009',
        price: 118.55,
      },
      {
        symbol: 'IBM',
        date: 'Oct 1 2009',
        price: 119.54,
      },
      {
        symbol: 'IBM',
        date: 'Nov 1 2009',
        price: 125.79,
      },
      {
        symbol: 'IBM',
        date: 'Dec 1 2009',
        price: 130.32,
      },
      {
        symbol: 'IBM',
        date: 'Jan 1 2010',
        price: 121.85,
      },
      {
        symbol: 'IBM',
        date: 'Feb 1 2010',
        price: 127.16,
      },
      {
        symbol: 'IBM',
        date: 'Mar 1 2010',
        price: 125.55,
      },
      {
        symbol: 'GOOG',
        date: 'Aug 1 2004',
        price: 102.37,
      },
      {
        symbol: 'GOOG',
        date: 'Sep 1 2004',
        price: 129.6,
      },
      {
        symbol: 'GOOG',
        date: 'Oct 1 2004',
        price: 190.64,
      },
      {
        symbol: 'GOOG',
        date: 'Nov 1 2004',
        price: 181.98,
      },
      {
        symbol: 'GOOG',
        date: 'Dec 1 2004',
        price: 192.79,
      },
      {
        symbol: 'GOOG',
        date: 'Jan 1 2005',
        price: 195.62,
      },
      {
        symbol: 'GOOG',
        date: 'Feb 1 2005',
        price: 187.99,
      },
      {
        symbol: 'GOOG',
        date: 'Mar 1 2005',
        price: 180.51,
      },
      {
        symbol: 'GOOG',
        date: 'Apr 1 2005',
        price: 220,
      },
      {
        symbol: 'GOOG',
        date: 'May 1 2005',
        price: 277.27,
      },
      {
        symbol: 'GOOG',
        date: 'Jun 1 2005',
        price: 294.15,
      },
      {
        symbol: 'GOOG',
        date: 'Jul 1 2005',
        price: 287.76,
      },
      {
        symbol: 'GOOG',
        date: 'Aug 1 2005',
        price: 286,
      },
      {
        symbol: 'GOOG',
        date: 'Sep 1 2005',
        price: 316.46,
      },
      {
        symbol: 'GOOG',
        date: 'Oct 1 2005',
        price: 372.14,
      },
      {
        symbol: 'GOOG',
        date: 'Nov 1 2005',
        price: 404.91,
      },
      {
        symbol: 'GOOG',
        date: 'Dec 1 2005',
        price: 414.86,
      },
      {
        symbol: 'GOOG',
        date: 'Jan 1 2006',
        price: 432.66,
      },
      {
        symbol: 'GOOG',
        date: 'Feb 1 2006',
        price: 362.62,
      },
      {
        symbol: 'GOOG',
        date: 'Mar 1 2006',
        price: 390,
      },
      {
        symbol: 'GOOG',
        date: 'Apr 1 2006',
        price: 417.94,
      },
      {
        symbol: 'GOOG',
        date: 'May 1 2006',
        price: 371.82,
      },
      {
        symbol: 'GOOG',
        date: 'Jun 1 2006',
        price: 419.33,
      },
      {
        symbol: 'GOOG',
        date: 'Jul 1 2006',
        price: 386.6,
      },
      {
        symbol: 'GOOG',
        date: 'Aug 1 2006',
        price: 378.53,
      },
      {
        symbol: 'GOOG',
        date: 'Sep 1 2006',
        price: 401.9,
      },
      {
        symbol: 'GOOG',
        date: 'Oct 1 2006',
        price: 476.39,
      },
      {
        symbol: 'GOOG',
        date: 'Nov 1 2006',
        price: 484.81,
      },
      {
        symbol: 'GOOG',
        date: 'Dec 1 2006',
        price: 460.48,
      },
      {
        symbol: 'GOOG',
        date: 'Jan 1 2007',
        price: 501.5,
      },
      {
        symbol: 'GOOG',
        date: 'Feb 1 2007',
        price: 449.45,
      },
      {
        symbol: 'GOOG',
        date: 'Mar 1 2007',
        price: 458.16,
      },
      {
        symbol: 'GOOG',
        date: 'Apr 1 2007',
        price: 471.38,
      },
      {
        symbol: 'GOOG',
        date: 'May 1 2007',
        price: 497.91,
      },
      {
        symbol: 'GOOG',
        date: 'Jun 1 2007',
        price: 522.7,
      },
      {
        symbol: 'GOOG',
        date: 'Jul 1 2007',
        price: 510,
      },
      {
        symbol: 'GOOG',
        date: 'Aug 1 2007',
        price: 515.25,
      },
      {
        symbol: 'GOOG',
        date: 'Sep 1 2007',
        price: 567.27,
      },
      {
        symbol: 'GOOG',
        date: 'Oct 1 2007',
        price: 707,
      },
      {
        symbol: 'GOOG',
        date: 'Nov 1 2007',
        price: 693,
      },
      {
        symbol: 'GOOG',
        date: 'Dec 1 2007',
        price: 691.48,
      },
      {
        symbol: 'GOOG',
        date: 'Jan 1 2008',
        price: 564.3,
      },
      {
        symbol: 'GOOG',
        date: 'Feb 1 2008',
        price: 471.18,
      },
      {
        symbol: 'GOOG',
        date: 'Mar 1 2008',
        price: 440.47,
      },
      {
        symbol: 'GOOG',
        date: 'Apr 1 2008',
        price: 574.29,
      },
      {
        symbol: 'GOOG',
        date: 'May 1 2008',
        price: 585.8,
      },
      {
        symbol: 'GOOG',
        date: 'Jun 1 2008',
        price: 526.42,
      },
      {
        symbol: 'GOOG',
        date: 'Jul 1 2008',
        price: 473.75,
      },
      {
        symbol: 'GOOG',
        date: 'Aug 1 2008',
        price: 463.29,
      },
      {
        symbol: 'GOOG',
        date: 'Sep 1 2008',
        price: 400.52,
      },
      {
        symbol: 'GOOG',
        date: 'Oct 1 2008',
        price: 359.36,
      },
      {
        symbol: 'GOOG',
        date: 'Nov 1 2008',
        price: 292.96,
      },
      {
        symbol: 'GOOG',
        date: 'Dec 1 2008',
        price: 307.65,
      },
      {
        symbol: 'GOOG',
        date: 'Jan 1 2009',
        price: 338.53,
      },
      {
        symbol: 'GOOG',
        date: 'Feb 1 2009',
        price: 337.99,
      },
      {
        symbol: 'GOOG',
        date: 'Mar 1 2009',
        price: 348.06,
      },
      {
        symbol: 'GOOG',
        date: 'Apr 1 2009',
        price: 395.97,
      },
      {
        symbol: 'GOOG',
        date: 'May 1 2009',
        price: 417.23,
      },
      {
        symbol: 'GOOG',
        date: 'Jun 1 2009',
        price: 421.59,
      },
      {
        symbol: 'GOOG',
        date: 'Jul 1 2009',
        price: 443.05,
      },
      {
        symbol: 'GOOG',
        date: 'Aug 1 2009',
        price: 461.67,
      },
      {
        symbol: 'GOOG',
        date: 'Sep 1 2009',
        price: 495.85,
      },
      {
        symbol: 'GOOG',
        date: 'Oct 1 2009',
        price: 536.12,
      },
      {
        symbol: 'GOOG',
        date: 'Nov 1 2009',
        price: 583,
      },
      {
        symbol: 'GOOG',
        date: 'Dec 1 2009',
        price: 619.98,
      },
      {
        symbol: 'GOOG',
        date: 'Jan 1 2010',
        price: 529.94,
      },
      {
        symbol: 'GOOG',
        date: 'Feb 1 2010',
        price: 526.8,
      },
      {
        symbol: 'GOOG',
        date: 'Mar 1 2010',
        price: 560.19,
      },
      {
        symbol: 'AAPL',
        date: 'Jan 1 2000',
        price: 25.94,
      },
      {
        symbol: 'AAPL',
        date: 'Feb 1 2000',
        price: 28.66,
      },
      {
        symbol: 'AAPL',
        date: 'Mar 1 2000',
        price: 33.95,
      },
      {
        symbol: 'AAPL',
        date: 'Apr 1 2000',
        price: 31.01,
      },
      {
        symbol: 'AAPL',
        date: 'May 1 2000',
        price: 21,
      },
      {
        symbol: 'AAPL',
        date: 'Jun 1 2000',
        price: 26.19,
      },
      {
        symbol: 'AAPL',
        date: 'Jul 1 2000',
        price: 25.41,
      },
      {
        symbol: 'AAPL',
        date: 'Aug 1 2000',
        price: 30.47,
      },
      {
        symbol: 'AAPL',
        date: 'Sep 1 2000',
        price: 12.88,
      },
      {
        symbol: 'AAPL',
        date: 'Oct 1 2000',
        price: 9.78,
      },
      {
        symbol: 'AAPL',
        date: 'Nov 1 2000',
        price: 8.25,
      },
      {
        symbol: 'AAPL',
        date: 'Dec 1 2000',
        price: 7.44,
      },
      {
        symbol: 'AAPL',
        date: 'Jan 1 2001',
        price: 10.81,
      },
      {
        symbol: 'AAPL',
        date: 'Feb 1 2001',
        price: 9.12,
      },
      {
        symbol: 'AAPL',
        date: 'Mar 1 2001',
        price: 11.03,
      },
      {
        symbol: 'AAPL',
        date: 'Apr 1 2001',
        price: 12.74,
      },
      {
        symbol: 'AAPL',
        date: 'May 1 2001',
        price: 9.98,
      },
      {
        symbol: 'AAPL',
        date: 'Jun 1 2001',
        price: 11.62,
      },
      {
        symbol: 'AAPL',
        date: 'Jul 1 2001',
        price: 9.4,
      },
      {
        symbol: 'AAPL',
        date: 'Aug 1 2001',
        price: 9.27,
      },
      {
        symbol: 'AAPL',
        date: 'Sep 1 2001',
        price: 7.76,
      },
      {
        symbol: 'AAPL',
        date: 'Oct 1 2001',
        price: 8.78,
      },
      {
        symbol: 'AAPL',
        date: 'Nov 1 2001',
        price: 10.65,
      },
      {
        symbol: 'AAPL',
        date: 'Dec 1 2001',
        price: 10.95,
      },
      {
        symbol: 'AAPL',
        date: 'Jan 1 2002',
        price: 12.36,
      },
      {
        symbol: 'AAPL',
        date: 'Feb 1 2002',
        price: 10.85,
      },
      {
        symbol: 'AAPL',
        date: 'Mar 1 2002',
        price: 11.84,
      },
      {
        symbol: 'AAPL',
        date: 'Apr 1 2002',
        price: 12.14,
      },
      {
        symbol: 'AAPL',
        date: 'May 1 2002',
        price: 11.65,
      },
      {
        symbol: 'AAPL',
        date: 'Jun 1 2002',
        price: 8.86,
      },
      {
        symbol: 'AAPL',
        date: 'Jul 1 2002',
        price: 7.63,
      },
      {
        symbol: 'AAPL',
        date: 'Aug 1 2002',
        price: 7.38,
      },
      {
        symbol: 'AAPL',
        date: 'Sep 1 2002',
        price: 7.25,
      },
      {
        symbol: 'AAPL',
        date: 'Oct 1 2002',
        price: 8.03,
      },
      {
        symbol: 'AAPL',
        date: 'Nov 1 2002',
        price: 7.75,
      },
      {
        symbol: 'AAPL',
        date: 'Dec 1 2002',
        price: 7.16,
      },
      {
        symbol: 'AAPL',
        date: 'Jan 1 2003',
        price: 7.18,
      },
      {
        symbol: 'AAPL',
        date: 'Feb 1 2003',
        price: 7.51,
      },
      {
        symbol: 'AAPL',
        date: 'Mar 1 2003',
        price: 7.07,
      },
      {
        symbol: 'AAPL',
        date: 'Apr 1 2003',
        price: 7.11,
      },
      {
        symbol: 'AAPL',
        date: 'May 1 2003',
        price: 8.98,
      },
      {
        symbol: 'AAPL',
        date: 'Jun 1 2003',
        price: 9.53,
      },
      {
        symbol: 'AAPL',
        date: 'Jul 1 2003',
        price: 10.54,
      },
      {
        symbol: 'AAPL',
        date: 'Aug 1 2003',
        price: 11.31,
      },
      {
        symbol: 'AAPL',
        date: 'Sep 1 2003',
        price: 10.36,
      },
      {
        symbol: 'AAPL',
        date: 'Oct 1 2003',
        price: 11.44,
      },
      {
        symbol: 'AAPL',
        date: 'Nov 1 2003',
        price: 10.45,
      },
      {
        symbol: 'AAPL',
        date: 'Dec 1 2003',
        price: 10.69,
      },
      {
        symbol: 'AAPL',
        date: 'Jan 1 2004',
        price: 11.28,
      },
      {
        symbol: 'AAPL',
        date: 'Feb 1 2004',
        price: 11.96,
      },
      {
        symbol: 'AAPL',
        date: 'Mar 1 2004',
        price: 13.52,
      },
      {
        symbol: 'AAPL',
        date: 'Apr 1 2004',
        price: 12.89,
      },
      {
        symbol: 'AAPL',
        date: 'May 1 2004',
        price: 14.03,
      },
      {
        symbol: 'AAPL',
        date: 'Jun 1 2004',
        price: 16.27,
      },
      {
        symbol: 'AAPL',
        date: 'Jul 1 2004',
        price: 16.17,
      },
      {
        symbol: 'AAPL',
        date: 'Aug 1 2004',
        price: 17.25,
      },
      {
        symbol: 'AAPL',
        date: 'Sep 1 2004',
        price: 19.38,
      },
      {
        symbol: 'AAPL',
        date: 'Oct 1 2004',
        price: 26.2,
      },
      {
        symbol: 'AAPL',
        date: 'Nov 1 2004',
        price: 33.53,
      },
      {
        symbol: 'AAPL',
        date: 'Dec 1 2004',
        price: 32.2,
      },
      {
        symbol: 'AAPL',
        date: 'Jan 1 2005',
        price: 38.45,
      },
      {
        symbol: 'AAPL',
        date: 'Feb 1 2005',
        price: 44.86,
      },
      {
        symbol: 'AAPL',
        date: 'Mar 1 2005',
        price: 41.67,
      },
      {
        symbol: 'AAPL',
        date: 'Apr 1 2005',
        price: 36.06,
      },
      {
        symbol: 'AAPL',
        date: 'May 1 2005',
        price: 39.76,
      },
      {
        symbol: 'AAPL',
        date: 'Jun 1 2005',
        price: 36.81,
      },
      {
        symbol: 'AAPL',
        date: 'Jul 1 2005',
        price: 42.65,
      },
      {
        symbol: 'AAPL',
        date: 'Aug 1 2005',
        price: 46.89,
      },
      {
        symbol: 'AAPL',
        date: 'Sep 1 2005',
        price: 53.61,
      },
      {
        symbol: 'AAPL',
        date: 'Oct 1 2005',
        price: 57.59,
      },
      {
        symbol: 'AAPL',
        date: 'Nov 1 2005',
        price: 67.82,
      },
      {
        symbol: 'AAPL',
        date: 'Dec 1 2005',
        price: 71.89,
      },
      {
        symbol: 'AAPL',
        date: 'Jan 1 2006',
        price: 75.51,
      },
      {
        symbol: 'AAPL',
        date: 'Feb 1 2006',
        price: 68.49,
      },
      {
        symbol: 'AAPL',
        date: 'Mar 1 2006',
        price: 62.72,
      },
      {
        symbol: 'AAPL',
        date: 'Apr 1 2006',
        price: 70.39,
      },
      {
        symbol: 'AAPL',
        date: 'May 1 2006',
        price: 59.77,
      },
      {
        symbol: 'AAPL',
        date: 'Jun 1 2006',
        price: 57.27,
      },
      {
        symbol: 'AAPL',
        date: 'Jul 1 2006',
        price: 67.96,
      },
      {
        symbol: 'AAPL',
        date: 'Aug 1 2006',
        price: 67.85,
      },
      {
        symbol: 'AAPL',
        date: 'Sep 1 2006',
        price: 76.98,
      },
      {
        symbol: 'AAPL',
        date: 'Oct 1 2006',
        price: 81.08,
      },
      {
        symbol: 'AAPL',
        date: 'Nov 1 2006',
        price: 91.66,
      },
      {
        symbol: 'AAPL',
        date: 'Dec 1 2006',
        price: 84.84,
      },
      {
        symbol: 'AAPL',
        date: 'Jan 1 2007',
        price: 85.73,
      },
      {
        symbol: 'AAPL',
        date: 'Feb 1 2007',
        price: 84.61,
      },
      {
        symbol: 'AAPL',
        date: 'Mar 1 2007',
        price: 92.91,
      },
      {
        symbol: 'AAPL',
        date: 'Apr 1 2007',
        price: 99.8,
      },
      {
        symbol: 'AAPL',
        date: 'May 1 2007',
        price: 121.19,
      },
      {
        symbol: 'AAPL',
        date: 'Jun 1 2007',
        price: 122.04,
      },
      {
        symbol: 'AAPL',
        date: 'Jul 1 2007',
        price: 131.76,
      },
      {
        symbol: 'AAPL',
        date: 'Aug 1 2007',
        price: 138.48,
      },
      {
        symbol: 'AAPL',
        date: 'Sep 1 2007',
        price: 153.47,
      },
      {
        symbol: 'AAPL',
        date: 'Oct 1 2007',
        price: 189.95,
      },
      {
        symbol: 'AAPL',
        date: 'Nov 1 2007',
        price: 182.22,
      },
      {
        symbol: 'AAPL',
        date: 'Dec 1 2007',
        price: 198.08,
      },
      {
        symbol: 'AAPL',
        date: 'Jan 1 2008',
        price: 135.36,
      },
      {
        symbol: 'AAPL',
        date: 'Feb 1 2008',
        price: 125.02,
      },
      {
        symbol: 'AAPL',
        date: 'Mar 1 2008',
        price: 143.5,
      },
      {
        symbol: 'AAPL',
        date: 'Apr 1 2008',
        price: 173.95,
      },
      {
        symbol: 'AAPL',
        date: 'May 1 2008',
        price: 188.75,
      },
      {
        symbol: 'AAPL',
        date: 'Jun 1 2008',
        price: 167.44,
      },
      {
        symbol: 'AAPL',
        date: 'Jul 1 2008',
        price: 158.95,
      },
      {
        symbol: 'AAPL',
        date: 'Aug 1 2008',
        price: 169.53,
      },
      {
        symbol: 'AAPL',
        date: 'Sep 1 2008',
        price: 113.66,
      },
      {
        symbol: 'AAPL',
        date: 'Oct 1 2008',
        price: 107.59,
      },
      {
        symbol: 'AAPL',
        date: 'Nov 1 2008',
        price: 92.67,
      },
      {
        symbol: 'AAPL',
        date: 'Dec 1 2008',
        price: 85.35,
      },
      {
        symbol: 'AAPL',
        date: 'Jan 1 2009',
        price: 90.13,
      },
      {
        symbol: 'AAPL',
        date: 'Feb 1 2009',
        price: 89.31,
      },
      {
        symbol: 'AAPL',
        date: 'Mar 1 2009',
        price: 105.12,
      },
      {
        symbol: 'AAPL',
        date: 'Apr 1 2009',
        price: 125.83,
      },
      {
        symbol: 'AAPL',
        date: 'May 1 2009',
        price: 135.81,
      },
      {
        symbol: 'AAPL',
        date: 'Jun 1 2009',
        price: 142.43,
      },
      {
        symbol: 'AAPL',
        date: 'Jul 1 2009',
        price: 163.39,
      },
      {
        symbol: 'AAPL',
        date: 'Aug 1 2009',
        price: 168.21,
      },
      {
        symbol: 'AAPL',
        date: 'Sep 1 2009',
        price: 185.35,
      },
      {
        symbol: 'AAPL',
        date: 'Oct 1 2009',
        price: 188.5,
      },
      {
        symbol: 'AAPL',
        date: 'Nov 1 2009',
        price: 199.91,
      },
      {
        symbol: 'AAPL',
        date: 'Dec 1 2009',
        price: 210.73,
      },
      {
        symbol: 'AAPL',
        date: 'Jan 1 2010',
        price: 192.06,
      },
      {
        symbol: 'AAPL',
        date: 'Feb 1 2010',
        price: 204.62,
      },
      {
        symbol: 'AAPL',
        date: 'Mar 1 2010',
        price: 223.02,
      },
    ],
  },
  mark: { type: 'line', point: true },
  // transform: [{ filter: "datum.symbol==='GOOG'" }],
  encoding: {
    x: { field: 'date', type: 'temporal' },
    y: { field: 'price', type: 'quantitative' },
    color: { field: 'symbol', type: 'nominal' },
  },
};

const data = {
  columns: ['country', 'group', 'opportunity_count'],
  data: [
    ['US', 'A', 10],
    ['US', 'B', 20],
    ['CN', 'A', 30],
    ['CN', 'B', 40],
  ],
};

export default function Test() {
  return (
    <div className="p-4">
      <Chart width={600} spec={spec} data={data} />
    </div>
  );
}
