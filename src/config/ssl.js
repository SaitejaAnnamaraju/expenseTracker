'use strict';
/**
 * TLS options for hosted MySQL (Aiven, TiDB Cloud, Railway, etc.).
 *   DB_SSL=true                      -> encrypt the connection
 *   DB_SSL_CA="-----BEGIN CERT..."   -> provider's CA certificate (PEM; "\n" escapes allowed)
 *   DB_SSL_REJECT_UNAUTHORIZED=false -> only if the provider gives no CA (less secure)
 */
function dbSsl() {
  if (String(process.env.DB_SSL || '').toLowerCase() !== 'true') return undefined;
  const ssl = { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false' };
  if (process.env.DB_SSL_CA) ssl.ca = process.env.DB_SSL_CA.replace(/\\n/g, '\n');
  return ssl;
}

module.exports = { dbSsl };
