SELECT 
  userId,
  SUBSTRING(tastytradeClientSecret, 1, 10) as clientSecretStart,
  LENGTH(tastytradeClientSecret) as clientSecretLength,
  SUBSTRING(tastytradeRefreshToken, 1, 30) as refreshTokenStart,
  LENGTH(tastytradeRefreshToken) as refreshTokenLength
FROM apiCredentials 
WHERE userId = 1;
