import axios from 'axios'

/** The single HTTP client. Every request goes through here so the bearer token and error shape stay consistent. */
export const api = axios.create({
  // Empty in development: requests go to /api on the Vite server, which proxies them to the backend.
  // Set VITE_API_URL (e.g. https://api.example.com) only for a build that calls the API on another origin.
  baseURL: import.meta.env.VITE_API_URL ?? '',
  headers: { 'Content-Type': 'application/json' },
})

// No token here: the API keeps it in an HttpOnly cookie that the browser sends with every same-origin /api call.
/** @type {(() => void)|null} */
let onUnauthorized = null

/**
 * Which side of the site a path belongs to. Each side has its own session cookie, so a customer tab and a staff tab
 * in one browser stay signed in as different people.
 * @param {string} path
 * @returns {'staff'|'customer'}
 */
export const portalOf = (path) => (path.startsWith('/admin') ? 'staff' : 'customer')

api.interceptors.request.use((config) => {
  config.headers['X-Portal'] = portalOf(window.location.pathname)
  // LanguageProvider keeps this attribute on the language in use; the API answers its errors in it.
  config.headers['Accept-Language'] = document.documentElement.lang
  return config
})

/** @param {(() => void)|null} handler */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // AuthProvider sets the handler only while someone is signed in, so a failed login does not trigger it.
    if (error.response?.status === 401) onUnauthorized?.()
    return Promise.reject(error)
  },
)

const english = () => document.documentElement.lang === 'en'

/** @typedef {{ title?: string, errors?: Object<string, string[]> }} ProblemDetails RFC 7807 error body */

/**
 * The message to show the user: the API's ProblemDetails title, or every field error for a 400.
 * @param {unknown} error
 * @returns {string}
 */
export function errorMessage(error) {
  if (axios.isAxiosError(error)) {
    if (!error.response) return english() ? 'Could not reach the server. Please try again.' : 'Không kết nối được máy chủ. Vui lòng thử lại.'
    /** @type {ProblemDetails|undefined} */
    const problem = error.response.data
    const fieldErrors = problem?.errors ? Object.values(problem.errors).flat() : []
    if (fieldErrors.length) return fieldErrors.join(' ')
    if (problem?.title) return problem.title
  }
  return english() ? 'Something went wrong. Please try again.' : 'Đã có lỗi xảy ra. Vui lòng thử lại.'
}
