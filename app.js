const express = require("express");
const path = require("path");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const dbpath = path.join(__dirname, "twitterClone.db");
const app = express();
app.use(express.json());
let db = null;
const initializedbAndServer = async () => {
  try {
    db = await open({
      filename: dbpath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("server running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(e.message);
    process.exit(1);
  }
};
initializedbAndServer();

// validating token
const validateToken = (request, response, next) => {
  const authHeaders = request.headers["authorization"];
  let jwtToken;
  if (authHeaders === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwtToken = authHeaders.split(" ")[1];
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

// Register new user
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const isUserExistsQuery = `
    SELECT *
    FROM user 
    WHERE username = "${username}";`;
  const isuser = await db.get(isUserExistsQuery);
  if (isuser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const updatedPassword = await bcrypt.hash(password, 10);

      const createUserQuery = `
            INSERT INTO user (username,password,name,gender)
            VALUES("${username}","${updatedPassword}","${name}","${gender}");`;
      await db.run(createUserQuery);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// create token
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;

  const isUserExistsQuery = `
    SELECT *
    FROM user 
    WHERE username = "${username}";`;
  const userData = await db.get(isUserExistsQuery);

  if (userData === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, userData.password);
    if (isPasswordMatched === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// get tweets of a user
app.get("/user/tweets/feed/", validateToken, async (request, response) => {
  const { username } = request;
  const getTweetsQuery = `
    SELECT user.username,tweet.tweet,tweet.date_time
    FROM user 
    NATURAL JOIN tweet
    WHERE tweet.user_id IN (
        SELECT following_user_id
        FROM follower JOIN user ON follower.follower_user_id = user.user_id
        WHERE user.username = "${username}"
    )
    ORDER BY tweet.date_time DESC
    LIMIT 4;`;
  const tweets = await db.all(getTweetsQuery);

  response.send(
    tweets.map((each) => {
      return {
        username: each.username,
        tweet: each.tweet,
        dateTime: each.date_time,
      };
    })
  );
});
// get user following
app.get("/user/following/", validateToken, async (request, response) => {
  const { username } = request;

  const followingQuery = `
    SELECT username from user
    WHERE user_id IN (
        SELECT following_user_id from user JOIN follower ON user.user_id = follower.follower_user_id
        WHERE user.username = '${username}'
    )`;
  const followersResponse = await db.all(followingQuery);
  response.send(
    followersResponse.map((eachUser) => {
      return {
        name: eachUser.username,
      };
    })
  );
});
// get the user followers
app.get("/user/followers/", validateToken, async (request, response) => {
  const { username } = request;
  const followersQuery = `
    SELECT username FROM user
    WHERE user_id IN (
        SELECT follower_user_id FROM user JOIN follower ON user.user_id = follower.following_user_id
        WHERE username = "${username}"
    );`;
  const followersResponse = await db.all(followersQuery);
  response.send(
    followersResponse.map((eachUser) => {
      return {
        name: eachUser.username,
      };
    })
  );
});

// get tweets by tweet id
app.get("/tweets/:tweetId/", validateToken, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;

  const tweetQuery = `
    SELECT *
    FROM tweet 
    WHERE tweet_id = ${tweetId} AND user_id IN (
        SELECT following_user_id FROM follower JOIN user ON follower.follower_user_id = user.user_id
        WHERE user.username = "${username}"
    );`;
  const tweetResponse = await db.get(tweetQuery);
  if (tweetResponse !== undefined) {
    const getTweetQuery = `
      SELECT tweet.tweet,COUNT(like_id),COUNT(reply_id),tweet.date_time
      FROM tweet JOIN like like ON tweet.tweet_id = like.tweet_id
      JOIN reply ON tweet.tweet_id = reply.tweet_id
      WHERE tweet.tweet_id = ${tweetId}
      GROUP BY tweet.tweet_id;`;
    const tweetDetails = await db.get(getTweetQuery);
    response.send({
      tweet: tweetDetails.tweet,
      likes: tweetDetails["COUNT(like_id)"],
      replies: tweetDetails["COUNT(reply_id)"],
      dateTime: tweetDetails.date_time,
    });
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

// get tweet like users 
app.get("/tweets/:tweetId/likes/", validateToken, async (request, response) => {
  const { tweetId } = request.params;
  const { username } = request;
  const isuserQuery = `
    SELECT * FROM tweet
    WHERE tweet_id = ${tweetId} AND user_id IN (
        SELECT following_user_id
        FROM follower JOIN user ON follower.follower_user_id = user.user_id
        WHERE username = "${username}"
    );`;
  const isValid = await db.get(isuserQuery);
  if (isValid === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const getUserQuery = `
    SELECT username FROM user
    WHERE user_id IN (
        SELECT user_id FROM like
        WHERE tweet_id = ${tweetId}
    );`;
    const usersResponse = await db.all(getUserQuery);
    console.log(usersResponse);
    response.send({ likes: usersResponse.map((each) => each.username) });
  }
});

// get replies of tweet
app.get(
  "/tweets/:tweetId/replies/",
  validateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const isValidQuery = `
    SELECT * from tweet
    WHERE tweet_id = ${tweetId} AND user_id IN (
        SELECT following_user_id FROM follower JOIN user ON follower.follower_user_id = user.user_id
        WHERE user.username = "${username}"
    );`;
    const isValid = await db.get(isValidQuery);
    if (isValid === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getRepliesQuery = `SELECT username,reply FROM 
      user NATURAL JOIN reply
      WHERE tweet_id = ${tweetId};`;
      const getReplies = await db.all(getRepliesQuery);
      response.send({
        replies: getReplies.map((each) => {
          return {
            name: each.username,
            reply: each.reply,
          };
        }),
      });
    }
  }
);

// get all tweets of user
app.get("/user/tweets/", validateToken, async (request, response) => {
  const { username } = request;
  const tweetsQuery = `
    SELECT tweet.tweet,COUNT(like_id),COUNT(reply_id),tweet.date_time
    FROM tweet JOIN like ON tweet.tweet_id = like.tweet_id
    JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id  = (
        SELECT user_id FROM user
        WHERE username = "${username}"
    )
    GROUP BY tweet.tweet_id
    ;`;
  const tweets = await db.all(tweetsQuery);
  response.send(
    tweets.map((each) => {
      return {
        tweet: each.tweet,
        likes: each["COUNT(like_id)"],
        replies: each["COUNT(reply_id)"],
        dateTime: each["date_time"],
      };
    })
  );
});
// post new tweet
app.post("/user/tweets/", validateToken, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;
  const userIdQuery = `
  SELECT user_id FROM user 
  WHERE username = "${username}";`;
  const userIdDetails = await db.get(userIdQuery);
  const { user_id } = userIdDetails;
  const newuserQuery = `
    INSERT INTO tweet (tweet,user_id)
    VALUES("${tweet}",${user_id});`;
  await db.run(newuserQuery);
  response.send(`Created a Tweet`);
});
// delete tweet by tweet id
app.delete("/tweets/:tweetId/", validateToken, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  const isvalidQuery = `
    SELECT * FROM tweet JOIN user ON tweet.user_id = user.user_id
    WHERE user.username = "${username}" AND tweet.tweet_id = ${tweetId};`;
  const isvalid = await db.get(isvalidQuery);
  if (isvalid === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteQuery = `
      DELETE FROM tweet
      WHERE tweet_id = ${tweetId};`;
    await db.run(deleteQuery);
    response.send(`Tweet Removed`);
  }
});

module.exports = app;
