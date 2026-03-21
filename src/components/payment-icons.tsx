"use client";

/** Tiny accepted-payment-method icon row for card forms. */
export function PaymentIcons() {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[9px] text-muted-foreground/40 uppercase tracking-wider">
        Accepted
      </span>
      <div className="flex items-center gap-1.5">
        {/* Visa */}
        <svg width="24" height="16" viewBox="0 0 24 16" fill="none" aria-label="Visa">
          <rect width="24" height="16" rx="2" fill="#1A1F71" />
          <path d="M9.8 11.2L11 4.8H12.6L11.4 11.2H9.8ZM16.4 5C16 4.8 15.4 4.6 14.6 4.6C13 4.6 11.8 5.4 11.8 6.6C11.8 7.4 12.6 7.9 13.2 8.2C13.8 8.5 14 8.7 14 9C14 9.4 13.6 9.6 13.2 9.6C12.6 9.6 12.2 9.5 11.6 9.2L11.4 9.1L11.2 10.4C11.6 10.6 12.4 10.8 13.2 10.8C14.8 10.8 16 10 16 8.7C16 8 15.6 7.5 14.6 7C14 6.8 13.8 6.6 13.8 6.4C13.8 6.1 14.2 5.9 14.6 5.9C15.2 5.9 15.6 6 16 6.2L16.2 6.3L16.4 5ZM19.4 4.8H18.2C17.8 4.8 17.5 4.9 17.4 5.3L15.2 11.2H16.8L17.1 10.2H19L19.2 11.2H20.6L19.4 4.8ZM17.6 9C17.8 8.4 18.4 6.8 18.4 6.8L18.8 9H17.6ZM8.8 4.8L7.2 9L7 8.2C6.6 7 5.6 5.8 4.4 5.2L5.8 11.2H7.4L10.4 4.8H8.8Z" fill="white" />
          <path d="M6.4 4.8H4L4 5C5.8 5.4 7 6.6 7.4 8L7 5.4C6.9 5 6.6 4.8 6.4 4.8Z" fill="#F9A825" />
        </svg>
        {/* Mastercard */}
        <svg width="24" height="16" viewBox="0 0 24 16" fill="none" aria-label="Mastercard">
          <rect width="24" height="16" rx="2" fill="#252525" />
          <circle cx="9.5" cy="8" r="4.5" fill="#EB001B" />
          <circle cx="14.5" cy="8" r="4.5" fill="#F79E1B" />
          <path d="M12 4.5C13.1 5.3 13.8 6.6 13.8 8C13.8 9.4 13.1 10.7 12 11.5C10.9 10.7 10.2 9.4 10.2 8C10.2 6.6 10.9 5.3 12 4.5Z" fill="#FF5F00" />
        </svg>
        {/* Amex */}
        <svg width="24" height="16" viewBox="0 0 24 16" fill="none" aria-label="Amex">
          <rect width="24" height="16" rx="2" fill="#2E77BC" />
          <path d="M3 7L4.5 4H6L7.5 7H6.5L6.2 6.3H4.3L4 7H3ZM4.6 5.6L5.2 5.6L4.9 4.8L4.6 5.6ZM7.5 7V4H9L10 5.8L11 4H12.5V7H11.5V5.2L10.4 7H9.6L8.5 5.2V7H7.5ZM3 12V9H7.5L8 9.6L8.5 9H14V11.8C14 11.8 13.6 12 13 12H8.5L8 11.3L7.5 12H3ZM4 11.2H5.2L5.7 10.6L6.2 11.2H11.5V10.7H8.5L8 10.1L7.5 10.7H4.8V10.1H7.3L8 9.5L7.3 9.8H4V11.2Z" fill="white" />
        </svg>
      </div>
    </div>
  );
}
