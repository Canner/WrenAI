export default function Marker() {
  // This is only used to embed definitions which can reused inside an svg image.
  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        zIndex: -1,
      }}
    >
      <defs>
        <marker
          id="many_right"
          viewBox="0 0 14 22"
          markerHeight={14}
          markerWidth={14}
          refX={0}
          refY={11}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M9.28866 10L6.49577e-06 2.33206L1.4329e-05 -1.18499e-06L13.5547 11L2.869e-06 22L3.07287e-06 19.668L9.28864 12L5.65057e-06 12L5.82542e-06 10L9.28866 10Z"
            fill="#b1b1b7"
          />
        </marker>
        <marker
          id="many_left"
          viewBox="0 0 14 22"
          markerHeight={14}
          markerWidth={14}
          refX={14}
          refY={11}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M4.26603 12L13.5547 19.6679L13.5547 22L0 11L13.5547 0V2.33204L4.26605 10L13.5547 10V12L4.26603 12Z"
            fill="#b1b1b7"
          />
        </marker>
        <marker
          id="one_right"
          viewBox="0 0 14 22"
          markerHeight={14}
          markerWidth={14}
          refX={-4}
          refY={11}
        >
          <rect
            width="1400"
            height="993"
            transform="translate(-407 -263)"
            fill="none"
          />
          <rect x="6" width="2" height="22" fill="#b1b1b7" />
        </marker>
        <marker
          id="one_left"
          viewBox="0 0 14 22"
          markerHeight={14}
          markerWidth={14}
          refX={18}
          refY={11}
        >
          <rect
            width="1400"
            height="993"
            transform="translate(-407 -263)"
            fill="none"
          />
          <rect x="6" width="2" height="22" fill="#b1b1b7" />
        </marker>

        {/* seleceted */}
        <marker
          id="many_right_selected"
          viewBox="0 0 18 32"
          markerHeight={18}
          markerWidth={18}
          refX={0}
          refY={16}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M13.4161 4.94444L13.2993 8H14.7007L14.5839 4.94444L17.2993 6.58333L18 5.41667L15.1387 4L18 2.58333L17.2993 1.41667L14.5839 3.05556L14.7007 0H13.2993L13.4161 3.05556L10.7007 1.41667L10 2.58333L12.8613 4L10 5.41667L10.7007 6.58333L13.4161 4.94444ZM3.63475e-06 7.33206L9.28865 15L2.9644e-06 15L2.78955e-06 17L9.28863 17L0 24.668V27L13.5547 16L1.1468e-05 5L3.63475e-06 7.33206Z"
            fill="#2F54EB"
          />
        </marker>
        <marker
          id="many_left_selected"
          viewBox="0 0 18 32"
          markerHeight={18}
          markerWidth={18}
          refX={18}
          refY={16}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M3.41606 4.94444L3.29927 8H4.70073L4.58394 4.94444L7.29927 6.58333L8 5.41667L5.13869 4L8 2.58333L7.29927 1.41667L4.58394 3.05556L4.70073 0H3.29927L3.41606 3.05556L0.70073 1.41667L0 2.58333L2.86131 4L0 5.41667L0.70073 6.58333L3.41606 4.94444ZM17.8899 24.6679L8.60127 17H17.8899V15H8.60129L17.8899 7.33204V5L4.33524 16L17.8899 27L17.8899 24.6679Z"
            fill="#2F54EB"
          />
        </marker>
        <marker
          id="one_right_selected"
          viewBox="0 0 16 32"
          markerHeight={16}
          markerWidth={16}
          refX={0}
          refY={16}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M16 8V0H15.0211L13 1.32812V2.3125L14.9737 1.01563H15.0211V8H16ZM8.63351 5H6.63351V27H8.63351V5Z"
            fill="#2F54EB"
          />
        </marker>
        <marker
          id="one_left_selected"
          viewBox="0 0 16 32"
          markerHeight={16}
          markerWidth={16}
          refX={18}
          refY={16}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M3 8V0H2.02105L0 1.32812V2.3125L1.97368 1.01563H2.02105V8H3ZM9 5H7V27H9V5Z"
            fill="#2F54EB"
          />
        </marker>
      </defs>
    </svg>
  );
}
