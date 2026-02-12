SELECT 
  userId,
  LENGTH(tastytradeClientSecret) as client_secret_length,
  LENGTH(tastytradeRefreshToken) as refresh_token_length,
  tastytradeUsername,
  updatedAt
FROM api_credentials
WHERE userId = 1;
