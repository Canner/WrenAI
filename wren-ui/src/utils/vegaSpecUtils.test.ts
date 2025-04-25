import { enhanceVegaSpec } from './vegaSpecUtils';

describe('vegaSpecUtils', () => {
  describe('enhanceVegaSpec', () => {
    it('should enhance a bar chart with proper styling and interactivity', () => {
      // Input Vega spec
      const inputSpec = {
        title: 'Total Payments by Customer State',
        mark: {
          type: 'bar',
        },
        encoding: {
          x: {
            field: 'customer_state',
            type: 'nominal',
            title: 'Customer State',
          },
          y: {
            field: 'total_payment_value',
            type: 'quantitative',
            title: 'Total Payment Value',
          },
        },
        $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
        data: {
          values: [],
        },
      };

      // Sample data
      const dataValues = [
        {
          customer_state: 'RR',
          total_payment_value: 10064.62,
        },
        {
          customer_state: 'PI',
          total_payment_value: 108523.97000000003,
        },
        {
          customer_state: 'PE',
          total_payment_value: 324850.4399999999,
        },
        {
          customer_state: 'PB',
          total_payment_value: 141545.7199999999,
        },
        {
          customer_state: 'RO',
          total_payment_value: 60866.2,
        },
        {
          customer_state: 'SE',
          total_payment_value: 75246.25,
        },
        {
          customer_state: 'TO',
          total_payment_value: 61485.32999999993,
        },
        {
          customer_state: 'AP',
          total_payment_value: 16262.8,
        },
        {
          customer_state: 'GO',
          total_payment_value: 350092.3100000009,
        },
        {
          customer_state: 'ES',
          total_payment_value: 325967.55000000045,
        },
        {
          customer_state: 'AM',
          total_payment_value: 27966.93,
        },
        {
          customer_state: 'SC',
          total_payment_value: 623086.43,
        },
        {
          customer_state: 'PA',
          total_payment_value: 218295.85,
        },
        {
          customer_state: 'MT',
          total_payment_value: 187029.28999999986,
        },
        {
          customer_state: 'AL',
          total_payment_value: 96962.06000000003,
        },
        {
          customer_state: 'SP',
          total_payment_value: 5998226.959999885,
        },
        {
          customer_state: 'MG',
          total_payment_value: 1872257.2600000093,
        },
        {
          customer_state: 'DF',
          total_payment_value: 355141.0799999998,
        },
        {
          customer_state: 'MA',
          total_payment_value: 152523.02000000002,
        },
        {
          customer_state: 'MS',
          total_payment_value: 137534.84000000003,
        },
        {
          customer_state: 'BA',
          total_payment_value: 616645.8200000012,
        },
        {
          customer_state: 'RJ',
          total_payment_value: 2144379.68999999,
        },
        {
          customer_state: 'PR',
          total_payment_value: 811156.379999998,
        },
        {
          customer_state: 'RN',
          total_payment_value: 102718.13,
        },
        {
          customer_state: 'AC',
          total_payment_value: 19680.62,
        },
        {
          customer_state: 'RS',
          total_payment_value: 890898.5399999967,
        },
        {
          customer_state: 'CE',
          total_payment_value: 279464.0300000001,
        },
      ];

      // Process spec with our utility
      const enhancedSpec: any = enhanceVegaSpec(inputSpec, dataValues);
      console.log(JSON.stringify(enhancedSpec, null, 2));

      // Define expected values for important properties
      expect(enhancedSpec).toEqual(
        expect.objectContaining({
          $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
          title: 'Total Payments by Customer State',
          width: 'container',
          height: 'container',
          autosize: expect.objectContaining({
            type: 'fit',
            contains: 'padding',
          }),
          mark: expect.objectContaining({
            type: 'bar',
          }),
        }),
      );

      // Check for config
      expect(enhancedSpec.config).toEqual(
        expect.objectContaining({
          mark: { tooltip: true },
          font: 'Roboto, Arial, Noto Sans, sans-serif',
          bar: { color: '#1570EF' },
          axisX: { labelAngle: -45 },
        }),
      );

      // Check for data values
      expect(enhancedSpec.data).toEqual({
        values: dataValues,
      });

      // Check for encodings
      expect(enhancedSpec.encoding).toEqual(
        expect.objectContaining({
          x: {
            field: 'customer_state',
            type: 'nominal',
            title: 'Customer State',
          },
          y: {
            field: 'total_payment_value',
            type: 'quantitative',
            title: 'Total Payment Value',
          },
          color: expect.objectContaining({
            field: 'customer_state',
            type: 'nominal',
            title: 'Customer State',
            scale: expect.objectContaining({
              range: expect.arrayContaining(['#7763CF', '#1570EF']),
            }),
          }),
          opacity: {
            condition: {
              param: 'hover',
              value: 1,
            },
            value: 0.3,
          },
        }),
      );

      // Check for interaction params
      expect(enhancedSpec.params).toEqual([
        {
          name: 'hover',
          select: {
            type: 'point',
            on: 'mouseover',
            clear: 'mouseout',
            fields: ['customer_state'],
          },
        },
      ]);
    });

    it('should handle line charts appropriately', () => {
      const lineSpec = {
        title: 'Value Over Time',
        mark: 'line',
        encoding: {
          x: {
            field: 'month',
            type: 'temporal',
            title: 'Month',
          },
          y: {
            field: 'value',
            type: 'quantitative',
            title: 'Value',
          },
        },
      };

      const data = [
        { month: '2023-01', value: 10 },
        { month: '2023-02', value: 20 },
        { month: '2023-03', value: 15 },
      ];

      const enhanced: any = enhanceVegaSpec(lineSpec, data);

      // Check that line chart gets point property set to true
      expect(enhanced.mark).toEqual(
        expect.objectContaining({
          type: 'line',
          point: true,
        }),
      );
    });

    it('should handle pie/arc charts appropriately', () => {
      const pieSpec = {
        title: 'Distribution by Category',
        mark: 'arc',
        encoding: {
          theta: {
            field: 'value',
            type: 'quantitative',
          },
          color: {
            field: 'category',
            type: 'nominal',
          },
        },
      };

      const data = [
        { category: 'A', value: 30 },
        { category: 'B', value: 45 },
        { category: 'C', value: 25 },
      ];

      const enhanced: any = enhanceVegaSpec(pieSpec, data);

      // Check that arc chart gets innerRadius for donut style
      expect(enhanced.mark).toEqual(
        expect.objectContaining({
          type: 'arc',
          innerRadius: 60,
        }),
      );
    });

    it('should handle stacked bar charts appropriately', () => {
      const stackedBarSpec = {
        title: 'Sales by Region and Product',
        mark: 'bar',
        encoding: {
          x: {
            field: 'region',
            type: 'nominal',
            title: 'Region',
          },
          y: {
            field: 'sales',
            type: 'quantitative',
            title: 'Sales',
            stack: true,
          },
          color: {
            field: 'product',
            type: 'nominal',
          },
        },
      };

      const data = [
        { region: 'North', product: 'A', sales: 100 },
        { region: 'North', product: 'B', sales: 150 },
        { region: 'South', product: 'A', sales: 120 },
        { region: 'South', product: 'B', sales: 180 },
        { region: 'East', product: 'A', sales: 90 },
        { region: 'East', product: 'B', sales: 110 },
        { region: 'West', product: 'A', sales: 140 },
        { region: 'West', product: 'B', sales: 160 },
      ];

      const enhanced: any = enhanceVegaSpec(stackedBarSpec, data);

      // Check that bar chart gets proper stacking
      expect(enhanced.encoding.y.stack).toBe('zero');
    });
  });
});
