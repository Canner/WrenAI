import logging
from typing import Any, Dict, Optional

import orjson
import pandas as pd
from haystack import component
from jsonschema.exceptions import ValidationError
from pydantic import BaseModel

logger = logging.getLogger("wren-ai-service")


def load_chart_theme() -> Dict[str, Any]:
    try:
        with open("src/pipelines/generation/utils/chart_theme.json", "r") as f:
            return orjson.loads(f.read())
    except (FileNotFoundError, IOError) as e:
        logger.error(f"Failed to load custom theme: {e}")
        return {}
    except orjson.JSONDecodeError as e:
        logger.error(f"Failed to parse custom theme: {e}")
        return {}


@component
class ChartDataPreprocessor:
    @component.output_types(
        sample_data=list[dict],
        sample_column_values=dict[str, Any],
    )
    def run(
        self,
        data: Dict[str, Any],
        sample_data_count: int = 15,
        sample_column_size: int = 5,
    ):
        columns = [
            column.get("name", "") if isinstance(column, dict) else column
            for column in data.get("columns", [])
        ]
        data = data.get("data", [])

        df = pd.DataFrame(data, columns=columns)
        sample_column_values = {
            col: list(df[col].unique())[:sample_column_size] for col in df.columns
        }

        if len(df) > sample_data_count:
            sample_data = df.sample(n=sample_data_count).to_dict(orient="records")
        else:
            sample_data = df.to_dict(orient="records")

        return {
            "raw_data": df.to_dict(orient="records"),
            "sample_data": sample_data,
            "sample_column_values": sample_column_values,
        }


@component
class ChartSchemaPreprocessor:
    @component.output_types(
        chart_schema=dict[str, Any],
    )
    def run(self, chart_schema: dict[str, Any]):
        chart_schema.pop("config", None)
        return chart_schema


@component
class ChartGenerationPostProcessor:
    @component.output_types(
        results=Dict[str, Any],
    )
    def run(
        self,
        replies: list[str],
        sample_data: list[dict],
        chart_theme: Optional[dict[str, Any]] = None,
    ):
        try:
            generation_result = orjson.loads(replies[0])
            reasoning = generation_result.get("reasoning", "")
            if chart_schema := generation_result.get("chart_schema", {}):
                # sometimes the chart_schema is still in string format
                if isinstance(chart_schema, str):
                    chart_schema = orjson.loads(chart_schema)

                chart_schema[
                    "$schema"
                ] = "https://vega.github.io/schema/vega-lite/v5.json"
                chart_schema["data"] = {"values": sample_data}
                if "mark" in chart_schema:
                    if isinstance(chart_schema["mark"], str):
                        chart_schema["mark"] = {
                            "type": chart_schema["mark"],
                            "tooltip": True,
                        }
                    else:
                        chart_schema["mark"]["tooltip"] = True
                if "hconcat" not in chart_schema and "vconcat" not in chart_schema:
                    chart_schema["autosize"] = {
                        "type": "fit",
                        "contains": "padding",
                        "resize": True,
                    }
                    chart_schema["height"] = 320
                    chart_schema["width"] = "container"
                if "encoding" in chart_schema:
                    if "x" in chart_schema["encoding"]:
                        if "axis" in chart_schema["encoding"]["x"]:
                            chart_schema["encoding"]["x"]["axis"]["labelAngle"] = 0
                    if "y" in chart_schema["encoding"]:
                        if "axis" in chart_schema["encoding"]["y"]:
                            chart_schema["encoding"]["y"]["axis"]["labelAngle"] = 0

                if chart_theme:
                    if "config" not in chart_schema:
                        chart_schema["config"] = {}
                    chart_schema["config"].update(chart_theme)

                return {
                    "results": {
                        "chart_schema": chart_schema,
                        "reasoning": reasoning,
                    }
                }

            return {
                "results": {
                    "chart_schema": {},
                    "reasoning": reasoning,
                }
            }
        except ValidationError as e:
            logger.exception(f"Vega-lite schema is not valid: {e}")

            return {
                "results": {
                    "chart_schema": {},
                    "reasoning": "",
                }
            }
        except Exception as e:
            logger.exception(f"JSON deserialization failed: {e}")

            return {
                "results": {
                    "chart_schema": {},
                    "reasoning": "",
                }
            }


CHART_GENERATION_GENERAL_INSTRUCTIONS = """
- Please generate the vega-lite schema using the v5 specification.
- Please omit the "data" field while generating the vega-lite schema.
- Please omit the "$schema" field while generating the vega-lite schema.
- Please omit the "description" field while generating the vega-lite schema.
- Please remember to add the "title" field to the vega-lite schema.
- Please remember to add the legend to the vega-lite schema.
- Please remember to add the "tooltip" field to the vega-lite schema.
- Please think hard and consider each example in SAMPLE_VEGA_LITE_SCHEMA_EXAMPLES first to generate the most appropriate vega-lite schema based on the sample data and the user's request.
- The language of the "title" field should be the same as the language provided by the user.
- If the sample data is empty, return an empty string as the value of the "chart_schema" field and explain the reason in the "reasoning" field.
- If there is only one column in the sample data and the column is not a number, return an empty string as the value of the "chart_schema" field and explain the reason in the "reasoning" field.
- If there is only one column in the sample data and the column is a number, chart type should be "text", the font size should be 60, width should be 300, height should be 100.
- If user is asking for a chart showing proportion/percentage by a certain column, chart type should be "donut chart".
- For horizontal bar charts, the order of the bars should be sorted descendingly by the value of the y-axis.
"""

SAMPLE_VEGA_LITE_SCHEMA_EXAMPLES = """
Following are some examples of vega-lite schema only including "key fields":

**Single value chart**
When to use:
- Use when you want to show a single value.
- Ideal for showing a single value, such as a total, average, or count.
Sample schema:
{
    "mark": {"type": "text", "tooltip": True},
    "encoding": {
        "text": {
            "field": "max_order_amount",
            "type": "quantitative"
        },
        "size": {
            "value": 60
        }
    }
}

**Vertical bar chart**
When to use:
- Use when you want to compare the values of different categories.
- Ideal for comparing values across categories, such as sales by product or revenue by region.
Sample schema:
{
    "mark": {"type": "bar", "tooltip": True},
    "encoding": {
        "x": {
            "field":"plan_type",
            "type":"nominal",
            "axis":{
                "title":"Plan Type"
            }
        },
        "y": {
            "field":"registrations",
            "type":"quantitative",
            "axis":{
                "title":"Registrations"
            }
        },
        "color": {
            "field":"plan_type",
            "type":"nominal",
            "legend": {
                "title":"Plan Type"
            }
        }
    }
}

**Horizontal bar chart**
When to use:
- Use when you want to compare the values of different categories and each categorical value is long or there are more than 10 categories.
- Ideal for comparing values across categories, such as sales by product or revenue by region.
Sample schema:
{
    "mark": {"type": "bar", "tooltip": True},
    "encoding": {
        "y": {
            "field":"tutorial_title",
            "type":"nominal",
            "axis":{
                "title":"Tutorial Title"
            }
        },
        "x": {
            "field":"total_view_time",
            "type":"quantitative",
            "axis":{
                "title":"Total View Time (Minutes)"
            }
        },
        "color": {
            "field":"tutorial_title",
            "type":"nominal",
            "legend": {
                "title":"Tutorial Title"
            }
        }
        }
}

**Area chart**
When to use:
- Use when you want to show how values develop over time.
- Ideal when the total is as important as its parts.
- Ideal when there are big differences between your values.
- Ideal when you're showing multiple series over time.
- Ideal when you have many data points.
Sample schema:
{
    "mark": {"type": "area", "tooltip": True},
    "encoding": {
        "x": {
            "field":"month",
            "type":"temporal",
            "axis":{
                "title":"Month",
                "format":"%b"
            }
        },
        "y": {
            "field":"Revenue",
            "type":"quantitative",
            "axis":{
                "title":"Revenue"
            }
        },
        "color": {
            "field":"Category",
            "type":"nominal",
            "legend": {
                "title":"Product Category"
            }
        }
    }
}

**Stacked bar chart**
When to use:
- Use when you want to compare the values of different categories and the values of the categories are related.
- Ideal for comparing values across categories, such as sales by product or revenue by region.
Sample schema:
{
    "mark": {"type": "bar", "tooltip": True},
    "encoding": {
        "x": {
            "field":"quarter",
            "type":"ordinal",
            "axis": {
                "title":"Quarter"
            }
        },
        "y": {
            "field":"Profit",
            "type":"quantitative",
            "axis": {
                "title":"Profit"
            }
        },
        "color": {
            "field":"Region",
            "type":"nominal",
            "legend": {
                "title":"Region"
            }
        }
    }
}

**Line chart**
When to use:
- Use when you want to show the trend of a numeric variable over time.
- Ideal for showing the trend of a numeric variable over time.
- Ideal when you have small changes between your values.
- Ideal when you have lots of x-axis values.
Sample schema:
{
    "mark": {"type": "line", "tooltip": True},
    "encoding": {
        "x": {
            "field":"month",
            "type":"temporal",
            "axis":{
                "title":"Month",
                "format":"%b"
            }
        },
        "y": {
            "field":"avg_duration",
            "type":"quantitative",
            "axis":{
                "title":"Average Session Duration (minutes)"
            }
        }
    }
}

**Scatter plot with color**
When to use:
- Use when you need to explore or show the relationship between two (or three, with color/size) quantitative variables.
- Ideal for spotting correlations, clusters, trends, and outliers (e.g. height vs. weight, advertising spend vs. sales).
Sample schema:
{
  "mark": {"type": "point", "tooltip": True},
  "encoding": {
    "x": {
      "field": "Horsepower",
      "type": "quantitative",
      "axis": {"title": "Horsepower"}
    },
    "y": {
      "field": "Miles_per_Gallon",
      "type": "quantitative",
      "axis": {"title": "Miles per Gallon"}
    },
    "color": {
      "field": "Origin",
      "type": "nominal",
      "legend": {"title": "Origin"}
    }
  }
}

**Stacked histogram**
When to use:
- Use when you want to compare the distribution of a numeric variable across two or more categories.
- Ideal for seeing both overall frequency and how groups (e.g. genders, segments) contribute within each bin.
Sample schema:
{
  "mark": {"type": "bar", "tooltip": True},
  "encoding": {
    "x": {
      "field": "weight",
      "type": "quantitative",
      "bin": { "maxbins": 30 },
      "axis": {
        "title": "weight →"
      }
    },
    "y": {
      "aggregate": "count",
      "type": "quantitative",
      "stack": "zero",
      "axis": {
        "title": "Frequency"
      }
    },
    "color": {
      "field": "gender",
      "type": "nominal",
      "scale": {
        "domain": ["female", "male"],
        "range": ["steelblue", "gold"]
      },
      "legend": {
        "title": ""
      }
    }
  }
}

**Layered Plot with Dual-Axis**
When to use:
- Use when you have two related metrics with very different scales but want to show them on the same domain (e.g. time).
- Ideal for contrasting trends—like overlaying revenue (in millions) and number of transactions (in thousands) over months—while cautioning that dual axes can be misleading if over-interpreted.
Sample schema:
{
  "encoding": {
    "x": {
      "timeUnit": "month",
      "field": "date",
      "axis": {"format": "%b", "title": null}
    }
  },
  "layer": [
    {
      "mark": {"opacity": 0.3, "type": "area", "color": "#85C5A6", "tooltip": True},
      "encoding": {
        "y": {
          "aggregate": "average",
          "field": "temp_max",
          "scale": {"domain": [0, 30]},
          "title": "Avg. Temperature (°C)",
          "axis": {"titleColor": "#85C5A6"}
        },
        "y2": {
          "aggregate": "average",
          "field": "temp_min"
        }
      }
    },
    {
      "mark": {"stroke": "#85A9C5", "type": "line", "interpolate": "monotone", "tooltip": True},
      "encoding": {
        "y": {
          "aggregate": "average",
          "field": "precipitation",
          "title": "Precipitation (inches)",
          "axis": {"titleColor":"#85A9C5"}
        }
      }
    }
  ],
  "resolve": {
    "scale": {
      "y": "independent"
    },
    "legend": {
      "color": "shared"
    }
  }
}

**Heatmap**
When to use:
- Use when you need to visualize magnitude or density across two categorical (or binned) dimensions.
- Ideal for correlation matrices, frequency tables (e.g. hour-of-day x day-of-week traffic), or any scenario where color intensity encodes value.
Sample schema:
{
  "mark": {"type": "rect", "tooltip": True},
  "encoding": {
    "x": {
      "field": "orders_order_date_week",
      "type": "temporal"
    },
    "y": {
      "field": "orders_status",
      "type": "nominal"
    },
    "color": {
      "field": "orders_total_order_amount",
      "type": "quantitative",
      "aggregate": "sum",
      "scale": {
        "scheme": "reds"
      }
    },
    "tooltip": [
      {
        "field": "orders_total_order_amount",
        "type": "quantitative",
        "aggregate": "sum"
      }
    ]
  }
}

**Bubble plot**
When to use:
- Use when you want to extend a scatter plot by encoding a third quantitative variable in bubble size (and possibly a fourth in color).
- Ideal for three-dimensional comparisons—like plotting companies by revenue (x), profit margin (y), and market cap (bubble size).
Sample schema:
{
  "mark": {"type": "point", "tooltip": True},
  "encoding": {
    "x": {
      "field": "orders_order_date_week",
      "type": "temporal"
    },
    "y": {
      "field": "orders_total_order_amount",
      "type": "quantitative"
    },
    "size": {
      "field": "customers_unique_customer_count",
      "type": "quantitative"
    }
  }
}

**Funnel chart**
When to use: 
- Use when you need to show a process that progresses through discrete stages with drop-offs at each step.
- Ideal for conversion analysis—e.g. website visits → product views → add-to-cart → purchases.
Sample schema:
{
  "config": {
    "view": {
      "strokeWidth": 0
    }
  },
  "transform": [
    {
      "calculate": "datum.orders_total_order_amount + ' ' + datum.orders_status",
      "as": "label"
    },
    {
      "window": [
        {
          "op": "lag",
          "field": "orders_total_order_amount",
          "as": "previous_value"
        }
      ],
      "frame": [
        1,
        0
      ]
    },
    {
      "calculate": "datum.previous_value ? (datum.orders_total_order_amount / datum.previous_value) * 100 : null",
      "as": "percent_of_previous"
    },
    {
      "calculate": "isValid(datum.percent_of_previous) ? '↓ ' + format(datum.percent_of_previous, '.1f') + '%' : 'N/A'",
      "as": "change_label"
    }
  ],
  "layer": [
    {
      "mark": {
        "type": "bar",
        "color": "#40817c",
        "tooltip": True
      },
      "encoding": {
        "x": {
          "field": "orders_total_order_amount",
          "type": "quantitative",
          "stack": "center",
          "axis": null
        },
        "y": {
          "field": "orders_status",
          "type": "nominal",
          "axis": null,
          "sort": null,
          "scale": {
            "padding": 0.3
          }
        },
        "color": {
          "field": "orders_status",
          "scale": {
            "range": [
              "#bde4e2",
              "#a2d0ce",
              "#87bcb9",
              "#6ea8a5",
              "#569490",
              "#40817c"
            ]
          }
        }
      }
    },
    {
      "mark": {
        "type": "text",
        "color": "black",
        "tooltip": True
      },
      "encoding": {
        "y": {
          "field": "orders_status",
          "type": "nominal",
          "axis": null,
          "sort": null
        },
        "text": {
          "field": "label"
        }
      }
    },
    {
      "mark": {
        "type": "text",
        "color": "black",
        "tooltip": True
      },
      "encoding": {
        "y": {
          "field": "orders_status",
          "type": "nominal",
          "axis": null,
          "sort": null
        },
        "yOffset": {
          "value": -12
        },
        "text": {
          "condition": {
            "test": "datum.change_label !== 'N/A'",
            "field": "change_label"
          },
          "value": ""
        }
      }
    }
  ]
}

**Map chart**
When to use:
- Use when your data has a geographic component and you want to reveal spatial patterns.
- Ideal for choropleth maps (e.g. population density, election results by region) or symbol maps (e.g. store locations sized by sales).
Sample schema:
{
  "projection": {
    "type": "mercator",
    "scale": 100, // Change scale to zoom into the map
    "center": [
      10,
      50
    ]
  },
  "layer": [
    {
      "data": {
        "url": "https://vega.github.io/vega-lite/data/world-110m.json",
        "format": {
          "type": "topojson",
          "feature": "countries"
        }
      },
      "mark": {
        "fill": "lightgray",
        "type": "geoshape",
        "stroke": "white",
        "tooltip": True
      }
    },
    {
      "mark": {"type": "circle", "tooltip": True},
      "encoding": {
        "size": {
          "type": "quantitative",
          "field": "orders_total_order_amount",
          "legend": {
            "title": "Total Order Amount"
          }
        },
        "color": {
          "field": "orders_status",
          "type": "nominal",
          "legend": {
            "title": "Order Status"
          }
        },
        "tooltip": [
          {
            "type": "ordinal",
            "field": "orders_status",
            "title": "Status"
          },
          {
            "type": "quantitative",
            "field": "orders_total_order_amount",
            "title": "Total Order Amount"
          }         
        ],
        "latitude": {
          "type": "quantitative",
          "field": "latitude"
        },
        "longitude": {
          "type": "quantitative",
          "field": "longitude"
        }
      }
    }
  ]
}

**Box plot with raw data(single quantitative field)**
When to use:
- Use when you want to visualize the distribution of a numeric variable across categories.
- Ideal for comparing the spread and central tendency of data across different groups.
Sample schema:
{
  "mark": {"type": "boxplot", "tooltip": True},
  "encoding": {
    "x": {"field": "Species", "type": "nominal"},
    "color": {"field": "Species", "type": "nominal", "legend": null},
    "y": {
      "field": "Body Mass (g)",
      "type": "quantitative",
      "scale": {"zero": false}
    }
  }
}

**Box plot with pre-aggregated data(min, Q1, median, Q3, max, etc.)**
When to use:
- Use when you want to visualize the distribution of a numeric variable across categories.
- Ideal for comparing the spread and central tendency of data across different groups.
Sample schema:
{
  "encoding": {"y": {"field": "Species", "type": "nominal", "title": null}},
  "layer": [
    {
      "mark": {"type": "rule", "tooltip": True},
      "encoding": {
        "x": {"field": "lower", "type": "quantitative","scale": {"zero": false}, "title": null},
        "x2": {"field": "upper"}
      }
    },
    {
      "mark": {"type": "bar", "size": 14, "tooltip": True},
      "encoding": {
        "x": {"field": "q1", "type": "quantitative"},
        "x2": {"field": "q3"},
        "color": {"field": "Species", "type": "nominal", "legend": null}
      }
    },
    {
      "mark": {"type": "tick", "color": "white", "size": 14, "tooltip": True},
      "encoding": {
        "x": {"field": "median", "type": "quantitative"}
      }
    },
    {
      "transform": [{"flatten": ["outliers"]}],
      "mark": {"type": "point", "style": "boxplot-outliers", "tooltip": True},
      "encoding": {
        "x": {"field": "outliers", "type": "quantitative"}
      }
    }
  ]
}

**Population pyramid**
When to use:
- Use it for demographic analysis, comparative cohort studies, monitoring population change, policy and resource planning
- Ideal for two complementary groups, ordered, exhaustive cohorts, sufficient sample size, desire for shape-based insights, clear labeling and axis scaling
Sample schema:
{
  "spacing": 0,
  "hconcat": [{
    "transform": [{
      "filter": {"field": "gender", "equal": "Female"}
    }],
    "title": "Female",
    "mark": {"type": "bar", "tooltip": True},
    "encoding": {
      "y": {
        "field": "age", "axis": null, "sort": "descending"
      },
      "x": {
        "aggregate": "sum", "field": "people",
        "title": "population",
        "axis": {"format": "s"},
        "sort": "descending"
      },
      "color": {
        "field": "gender",
        "scale": {"range": ["#675193", "#ca8861"]},
        "legend": null
      }
    }
  }, {
    "width": 20,
    "view": {"stroke": null},
    "mark": {
      "type": "text",
      "align": "center",
      "tooltip": True
    },
    "encoding": {
      "y": {"field": "age", "type": "ordinal", "axis": null, "sort": "descending"},
      "text": {"field": "age", "type": "quantitative"}
    }
  }, {
    "transform": [{
      "filter": {"field": "gender", "equal": "Male"}
    }],
    "title": "Male",
    "mark": {"type": "bar", "tooltip": True},
    "encoding": {
      "y": {
        "field": "age", "title": null,
        "axis": null, "sort": "descending"
      },
      "x": {
        "aggregate": "sum", "field": "people",
        "title": "population",
        "axis": {"format": "s"}
      },
      "color": {
        "field": "gender",
        "legend": null
      }
    }
  }],
  "config": {
    "view": {"stroke": null},
    "axis": {"grid": false}
  }
}

**Candlestick chart**
When to use:
- Use when you want to visualize the price movement of a security over time.
- Ideal for financial analysis, technical analysis, and trend identification.
Sample schema:
{
    "vconcat": [
        {
            "title": "Daily OHLC Candlestick Chart with Trading Signals (June 1 - July 31, 2009)",
            "width": 700,
            "height": 300,
            "layer": [
                {
                    "mark": {
                        "type": "rule",
                        "tooltip": True
                    },
                    "encoding": {
                        "x": {
                            "field": "date",
                            "type": "temporal",
                            "axis": {
                                "title": "Date"
                            }
                        },
                        "y": {
                            "field": "low",
                            "type": "quantitative",
                            "axis": {
                                "title": "Price"
                            }
                        },
                        "y2": {
                            "field": "high",
                            "type": "quantitative"
                        },
                        "color": {
                            "field": "signal",
                            "type": "nominal",
                            "legend": {
                                "title": "Signal"
                            },
                            "scale": {
                                "domain": [
                                    "long",
                                    "short",
                                    "neutral"
                                ],
                                "range": [
                                    "#2ca02c",
                                    "#d62728",
                                    "#7f7f7f"
                                ]
                            }
                        }
                    }
                },
                {
                    "mark": {
                        "type": "bar",
                        "size": 8,
                        "tooltip": True
                    },
                    "encoding": {
                        "x": {
                            "field": "date",
                            "type": "temporal"
                        },
                        "y": {
                            "field": "open",
                            "type": "quantitative"
                        },
                        "y2": {
                            "field": "close",
                            "type": "quantitative"
                        },
                        "color": {
                            "field": "signal",
                            "type": "nominal",
                            "legend": null,
                            "scale": {
                                "domain": [
                                    "long",
                                    "short",
                                    "neutral"
                                ],
                                "range": [
                                    "#2ca02c",
                                    "#d62728",
                                    "#7f7f7f"
                                ]
                            }
                        }
                    }
                }
            ]
        },
        {
            "title": "Daily Return (%) by Trading Signal (June 1 - July 31, 2009)",
            "width": 700,
            "height": 120,
            "mark": {"type": "bar", "tooltip": True},
            "encoding": {
                "x": {
                    "field": "date",
                    "type": "temporal",
                    "axis": {
                        "title": "Date"
                    }
                },
                "y": {
                    "field": "ret",
                    "type": "quantitative",
                    "axis": {
                        "title": "Return (%)"
                    }
                },
                "color": {
                    "field": "signal",
                    "type": "nominal",
                    "legend": {
                        "title": "Signal"
                    },
                    "scale": {
                        "domain": [
                            "long",
                            "short",
                            "neutral"
                        ],
                        "range": [
                            "#2ca02c",
                            "#d62728",
                            "#7f7f7f"
                        ]
                    }
                }
            }
        }
    ]
}
"""


class ChartGenerationResults(BaseModel):
    reasoning: str
    chart_schema: dict


CHART_GENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "chart_generation_results",
            "schema": ChartGenerationResults.model_json_schema(),
        },
    }
}
