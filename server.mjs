import express, { response } from 'express'
import knex from 'knex'
import bcrypt from 'bcrypt'
import cors from 'cors'

const app = express()
const port = 3001
const saltRounds = 10;

const db = knex({
    client: 'pg',
    connection: {
      host : '127.0.0.1',
      user : 'postgres',
      password : 'reborn',
      database : 'optilearn'
    }
})

app.use(express.urlencoded({extended: false}))
app.use(express.json())
app.use(cors())

app.post('/login',(req,res)=>{
    const {email,password} = req.body
    let hash
    db.select('*').from('login').where({
        email: email
    })
    .then(user=>{
        hash = user[0].hash
        bcrypt.compare(password, hash, (err, result) => {
            if(result){
                return db.select('*').from('users')
                .where('email','=',email)
                .then(user=>{

                    //========================================

                    db('users').where({id: user[0].id})
                    .update({
                        last_connection: new Date()
                    })
                    .then()

                    //========================================

                    res.json(user[0])
                })
                .catch(error=> res.status(400).json('Authentication failed'))
            }
            else{
                res.status(400).json('Authentication failed')
            }
        });
    })
    .catch(error=>{
        res.status(400).json('Authentication failed')
    })
})

app.post('/signin',(req,res)=>{
    const {name,lastname,email,password} = req.body

    if(name=="" || lastname=="" || email=="" || password==""){
        res.status(400).json('Registration failed')
    }

    bcrypt.hash(password, saltRounds, function(err, hash) {
        db.transaction(trx => {
            trx.insert({
                hash: hash,
                email: email
            })
            .into('login')
            .returning('email')
            .then(loginEmail => {
                return trx('users')
                .returning('*')
                .insert({
                    email: loginEmail[0],
                    name: name,
                    lastname: lastname,
                    joined: new Date(),
                    last_connection: new Date()
                })
                .then(user=>{
                    res.json(user[0])
                })
                .then(trx.commit)
                .catch(error=>{
                    res.status(400).json('Registration failed')
                    trx.rollback()
                })
            })
            .catch(error=>{
                res.status(400).json('Registration failed')
                trx.rollback()
            })
        })
        .catch(error=>{
            res.status(400).json('Registration failed')
        })
    });
})

//-1: Default, -2: None, else: customized
app.post('/new-topic',(req,res)=>{
    const {name,topicReferences,reviewArray,id,firstSessionDate} = req.body
    const day = 86400000
    const numberOfCompletedReviews = 0

    let completed = (reviewArray.length==0? true:false)

    db.transaction(trx=>{
        trx('topics').insert({
            name: name,
            user_id: id,
            first_session_date: new Date(firstSessionDate),
            topic_references: topicReferences,
            completed: completed,
            number_of_reviews: reviewArray.length,
            number_of_completed_reviews: numberOfCompletedReviews
        })
        .returning('id')
        .then(topicId=>{
            reviewArray.forEach(dfltDay=>{
                return trx.insert({
                    topic_id: topicId[0],
                    done: false,
                    review_date: new Date(firstSessionDate+(day*dfltDay)),
                    user_id: id
                })
                .into('reviews')
                .catch(error => {
                    trx.rollback();
                    res.status(400).json('Something went wrong')
                })
            })
        })
        .then( () => {
            trx.commit()
            res.json('Success');
        })
        .catch( error => {
            trx.rollback();
            res.status(400).json("Something went wrong");
        })
    })    
})

app.post('/new-customized-review',(req,res)=>{
    const {name,days,userId} = req.body

    db.insert({
        name: name,
        days: days,
        user_id: userId
    })
    .into('users_customized_reviews')
    .returning('id')
    .then((ucrid)=>{
        res.json(ucrid[0])
    })
    .catch(error=>{
        res.status(400).json('Something went wrong')
    })
})

app.post('/topics',(req,res)=>{
    const {userId} = req.body;

    db.select('*').from('topics').where({
        user_id: userId
    })
    .then((topics)=>{
        res.json(topics)
    })
    .catch(error => res.status(400).json('Something went wrong'))
})

app.post('/reviews',(req,res)=>{
    const {userId} = req.body

    db.select('*').from('reviews').where({
        user_id: userId
    })
    .then((reviews)=>{
        res.json(reviews);
    })
    .catch(error => res.status(400).json('Something went wrong'))
})

app.post('/undo-review',(req,res)=>{

    const {reviewId,topicId,numberOfReviews} = req.body
    let {numberOfCompletedReviews} = req.body
    let topicCompleted

    numberOfCompletedReviews--
    if(numberOfCompletedReviews<numberOfReviews) topicCompleted = false

    db.transaction(trx=>{
        return trx('reviews').where({id: reviewId})
        .update({done: false})
        .then(()=>{
            return trx('topics').where({id: topicId})
            .update({
                completed: topicCompleted,
                number_of_completed_reviews: numberOfCompletedReviews
            })
            .catch(err=>{
                trx.rollback()
                res.status(400).json('failed')
            })
        })
        .then(trx.commit)
        .catch(trx.rollback)
    })
    .then(()=>res.json('success'))
    .catch(err=>res.status(400).json('failed'))

    //res.json('success')

})

app.post('/do-review',(req,res)=>{
    const {reviewId,topicId,numberOfReviews} = req.body
    let {numberOfCompletedReviews} = req.body
    let topicCompleted = false

    numberOfCompletedReviews++
    if(numberOfCompletedReviews==numberOfReviews) topicCompleted = true

    db.transaction(trx=>{
        return trx('reviews').where({id: reviewId})
        .update({done: true})
        .then(()=>{
            return trx('topics').where({id: topicId})
            .update({
                completed: topicCompleted,
                number_of_completed_reviews: numberOfCompletedReviews
            })
            .catch(err=>{
                trx.rollback()
                res.status(400).json('failed')
            })
        })
        .then(trx.commit)
        .catch(trx.rollback)
    })
    .then(()=>res.json('success'))
    .catch(err=>res.status(400).json('failed'))
})

app.post('/reschedule',(req,res)=>{
    const {date,reviewId} = req.body

    db('reviews').where({id: reviewId})
    .update({
        review_date: new Date(date)
    })
    .then(()=>res.json('success'))
    .catch(error=>res.status(400).json('failed'))
})

app.post('/delete-history',(req,res)=>{
    const {userId} = req.body

    db('reviews').where({
        user_id: userId,
        done: true
    })
    .del()
    .then(()=>res.json('success'))
    .catch(error=>res.status(400).json('failed'))
})

//select * from reviews where user_id=20 and done=false and review_date<'2021-03-17';
app.post('/delete-missed',(req,res)=>{
    const {userId} = req.body
    const today = new Date().toDateString()

    db('reviews').where({
        user_id: userId,
        done: false,
    })
    .andWhere('review_date','<',today)
    .del()
    .then(()=>res.json('success'))
    .catch(error=>res.status(400).json('failed'))
})

app.post('/delete-topic',(req,res)=>{
    const {userId,topicId} = req.body

    db('reviews').where({
        user_id: userId,
        topic_id: topicId
    })
    .del()
    .then(()=>{
        db('topics').where({
            user_id: userId,
            id: topicId
        })
        .del()
        .then(()=>res.json('success'))
        .catch(error=>res.status(400).json('failed'))
    })
    .catch(error=>res.status(400).json('failed'))
})

app.post('/edit-topic',(req,res)=>{
    const {userId,topicId,newReferences,newTopicName} = req.body

    db('topics').where({
        user_id: userId,
        id: topicId
    })
    .update({
        topic_references: newReferences,
        name: newTopicName
    })
    .then(()=>res.json('success'))
    .catch(error=>res.json('failed'))
})

app.post('/get-customized-reviews',(req,res)=>{
    const {userId} = req.body
    db.select('*').from('users_customized_reviews').where({user_id: userId})
    .then(userCustomizedReviews=>{
        res.json(userCustomizedReviews)
    })
    .catch(err=>res.status(400).json('failed'))
})

app.listen(port)