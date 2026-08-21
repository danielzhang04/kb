/** Action classifiers shared by the read-only Tasks projection and governed card responses. */
export const HUMAN_INPUT_ACTION = /(?:^|[:/_-])(?:needs?-?input|human-?input|input-?required|question|human-?review|review-?required)(?:$|[:/_-])/i;
export const WAKE_ACTION = /^wake-me(?::|$)/i;
