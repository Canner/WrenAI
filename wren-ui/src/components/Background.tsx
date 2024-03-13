export default function Background() {
  return (
    <svg
      style={{
        position: 'absolute',
        width: '100%',
        height: '100%',
        top: 0,
        left: 0,
      }}
    >
      <pattern
        id="pattern-1"
        x="9.977201126492528"
        y="8.311077040116004"
        width="15.587323933968609"
        height="15.587323933968609"
        patternUnits="userSpaceOnUse"
        patternTransform="translate(-0.487103872936519,-0.487103872936519)"
      >
        <circle
          cx="0.487103872936519"
          cy="0.487103872936519"
          r="0.487103872936519"
          fill="#91919a"
        ></circle>
      </pattern>
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill="url(#pattern-1)"
      ></rect>
    </svg>
  );
}
